// VAT extraction math for receipts. Pure — runs on server + client (the
// form has live recompute). Routes every number through @/lib/money for
// EPSILON-safe rounding; no float drift.

import { parseMoney, percent, round2, round3, subtract } from '@/lib/money';

export type VatComputeInput = {
  /** Operator-typed values. Any can be 0 / undefined; the computer fills the
   *  gaps according to `mode` and `vatIncluded`. */
  subtotal?: number;
  vatAmount?: number;
  total?: number;
  vatRatePercent?: number;
  vatIncluded: boolean;
  /** Which field the operator most recently edited. The other two recompute. */
  driver: 'subtotal' | 'vatAmount' | 'total' | 'rate' | 'init';
};

export type VatComputeResult = {
  subtotal: number;
  vatAmount: number;
  total: number;
  vatRatePercent: number;
};

/** Recompute VAT triplet from one or two known values. The "driver" tells us
 *  which field the operator just edited; the other two are derived.
 *
 *  Rules:
 *    - driver='total' + rate + vat_included=true  → split gross into net/vat
 *    - driver='subtotal' + rate + vat_included=false → vat=sub*rate, total=sub+vat
 *    - driver='vatAmount' → the VAT is an explicit override (customs receipts
 *      compute VAT on a different base than the invoice net, so vat ≠ rate·net
 *      is legitimate). Keep the typed VAT AND the anchor the operator already
 *      entered: gross stays put when vat_included (net = gross − vat), net
 *      stays put otherwise (gross = net + vat). Only when neither is set does
 *      the rate derive the missing side.
 *    - driver='rate' → re-derive vat using the same vat_included strategy
 *    - driver='init' → a CONSISTENT triplet (net + vat = gross) is accepted
 *      verbatim even when vat ≠ rate·net — this is what lets a manually
 *      overridden VAT survive the server-side recompute on save. Anything
 *      inconsistent is normalized from the rate as before.
 *
 *  When inputs are ambiguous (e.g. only rate provided) the function leaves
 *  numeric fields at 0 rather than guessing.
 */
export function computeVat(input: VatComputeInput): VatComputeResult {
  const rate = round3(input.vatRatePercent ?? 0);
  const sub0 = round2(input.subtotal ?? 0);
  const vat0 = round2(input.vatAmount ?? 0);
  const total0 = round2(input.total ?? 0);

  // Consistent triplet on init → trust it. The operator (or a prior save)
  // already balanced the line; re-deriving from the rate here would clobber
  // manual VAT overrides on every round-trip.
  if (
    input.driver === 'init' &&
    total0 > 0 &&
    vat0 >= 0 &&
    Math.abs(round2(sub0 + vat0) - total0) <= 0.011
  ) {
    return { subtotal: sub0, vatAmount: vat0, total: total0, vatRatePercent: rate };
  }

  if (rate <= 0) {
    // Zero-VAT path. subtotal == total, vat == 0.
    const t =
      input.driver === 'total' || input.driver === 'rate'
        ? total0
        : input.driver === 'subtotal'
          ? sub0
          : total0 || sub0;
    return { subtotal: t, vatAmount: 0, total: t, vatRatePercent: 0 };
  }

  // VAT-included: operator typed gross, derive net/vat
  if (input.vatIncluded) {
    if (
      input.driver === 'total' ||
      input.driver === 'rate' ||
      (input.driver === 'init' && total0 > 0)
    ) {
      const denom = 1 + rate / 100;
      const sub = round2(total0 / denom);
      const vat = subtract(total0, sub);
      return { subtotal: sub, vatAmount: vat, total: total0, vatRatePercent: rate };
    }
    if (input.driver === 'subtotal' || (input.driver === 'init' && sub0 > 0)) {
      // Less common — operator types net + rate with vat_included=true. Reverse:
      // total = sub * (1 + rate/100).
      const vat = percent(sub0, rate);
      const total = round2(sub0 + vat);
      return { subtotal: sub0, vatAmount: vat, total, vatRatePercent: rate };
    }
    if (input.driver === 'vatAmount') {
      // Manual VAT override. Keep the gross the operator already typed and
      // fit the net around it; fall back to keeping the net; derive from
      // the rate only when neither anchor exists.
      if (total0 > 0) {
        const sub = subtract(total0, vat0);
        return { subtotal: sub, vatAmount: vat0, total: total0, vatRatePercent: rate };
      }
      if (sub0 > 0) {
        const total = round2(sub0 + vat0);
        return { subtotal: sub0, vatAmount: vat0, total, vatRatePercent: rate };
      }
      const sub = round2((vat0 * 100) / rate);
      const total = round2(sub + vat0);
      return { subtotal: sub, vatAmount: vat0, total, vatRatePercent: rate };
    }
  } else {
    // VAT-excluded: operator typed net, derive vat/gross
    if (
      input.driver === 'subtotal' ||
      input.driver === 'rate' ||
      (input.driver === 'init' && sub0 > 0)
    ) {
      const vat = percent(sub0, rate);
      const total = round2(sub0 + vat);
      return { subtotal: sub0, vatAmount: vat, total, vatRatePercent: rate };
    }
    if (input.driver === 'total' || (input.driver === 'init' && total0 > 0)) {
      const denom = 1 + rate / 100;
      const sub = round2(total0 / denom);
      const vat = subtract(total0, sub);
      return { subtotal: sub, vatAmount: vat, total: total0, vatRatePercent: rate };
    }
    if (input.driver === 'vatAmount') {
      // Manual VAT override (VAT-excluded entry): keep the net the operator
      // typed and put the VAT on top; fall back to fitting inside a typed
      // gross; derive from the rate only when neither anchor exists.
      if (sub0 > 0) {
        const total = round2(sub0 + vat0);
        return { subtotal: sub0, vatAmount: vat0, total, vatRatePercent: rate };
      }
      if (total0 > 0) {
        const sub = subtract(total0, vat0);
        return { subtotal: sub, vatAmount: vat0, total: total0, vatRatePercent: rate };
      }
      const sub = round2((vat0 * 100) / rate);
      const total = round2(sub + vat0);
      return { subtotal: sub, vatAmount: vat0, total, vatRatePercent: rate };
    }
  }

  // Fallback: return what was given.
  return {
    subtotal: sub0,
    vatAmount: vat0,
    total: total0 || round2(sub0 + vat0),
    vatRatePercent: rate,
  };
}

/** Build a 'YYYY-Qn' label from an ISO-formatted receipt date. */
export function vatQuarterForDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-/.exec(isoDate);
  if (!m) return '';
  const year = m[1];
  const month = Number(m[2]);
  const q = Math.ceil(month / 3);
  return `${year}-Q${q}`;
}

// Re-export to keep parseMoney callable from form callers without an extra
// import surface in templates.
export { parseMoney };
