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
 *    - driver='vatAmount' → preserve the explicit VAT, recompute the other side
 *      based on whichever of subtotal/total is still set
 *    - driver='rate' → re-derive vat using the same vat_included strategy
 *    - driver='init' → just normalize whatever was passed in
 *
 *  When inputs are ambiguous (e.g. only rate provided) the function leaves
 *  numeric fields at 0 rather than guessing.
 */
export function computeVat(input: VatComputeInput): VatComputeResult {
  const rate = round3(input.vatRatePercent ?? 0);
  const sub0 = round2(input.subtotal ?? 0);
  const vat0 = round2(input.vatAmount ?? 0);
  const total0 = round2(input.total ?? 0);

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
      // Preserve VAT, derive sub from rate: sub = vat * 100 / rate.
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
