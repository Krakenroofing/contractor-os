// Pure progress-billing math for the invoice form — no DB / React / mock
// imports so it runs on either side of the dual-backend split and can be
// unit-tested directly.
//
// BILLING TRACKS:
//   Every invoice on a project bills against exactly one contract source:
//     - a linked change order  → that CO's own value + CO-linked priors
//     - no CO                  → the ORIGINAL base contract value +
//                                base-track priors (invoices not linked to
//                                any CO)
//   A % draw therefore never totals from the revised project value. 50% of
//   a $10k CO is $5k regardless of the base contract size, and base-draw %
//   numbers don't silently reshape when a CO gets approved. This mirrors
//   the track split on the invoice detail page and the rendered PDF
//   payload (invoice-payload.ts).

export type ProgressSourceCO = {
  label: string;
  total?: number;
  priorBilledGross?: number;
  priorBilledNet?: number;
  priorInvoiceCount?: number;
};

export type ProgressSourceProject = {
  contractValue?: number;
  baseContractValue?: number;
  priorBilledGross?: number;
  priorBilledNet?: number;
  priorInvoiceCount?: number;
};

export type ProgressSource = {
  kind: 'base' | 'co';
  /** Display label — the CO number, or 'base contract'. */
  label: string;
  /** Contract base the % applies to. */
  value: number;
  /** Gross subtotals previously billed on the SAME track. */
  priorGross: number;
  /** Previously billed net of retainage on the same track. */
  priorNet: number;
  priorCount: number;
};

/**
 * Which contract base does this invoice bill against? A linked CO always
 * wins — even when its total is 0 (the caller surfaces "CO has no value"
 * rather than silently falling back to the project total, which is the
 * exact bug this module exists to prevent).
 */
export function resolveProgressSource(
  changeOrder: ProgressSourceCO | undefined,
  project: ProgressSourceProject | undefined,
): ProgressSource | null {
  if (changeOrder) {
    return {
      kind: 'co',
      label: changeOrder.label,
      value: changeOrder.total ?? 0,
      priorGross: changeOrder.priorBilledGross ?? 0,
      priorNet: changeOrder.priorBilledNet ?? 0,
      priorCount: changeOrder.priorInvoiceCount ?? 0,
    };
  }
  if (project) {
    return {
      kind: 'base',
      label: 'base contract',
      value: project.baseContractValue ?? project.contractValue ?? 0,
      priorGross: project.priorBilledGross ?? 0,
      priorNet: project.priorBilledNet ?? 0,
      priorCount: project.priorInvoiceCount ?? 0,
    };
  }
  return null;
}

export type ProgressNumbers = {
  contract: number;
  pct: number;
  priorGross: number;
  priorNet: number;
  priorCount: number;
  retentionPct: number;
  cumulativeBilled: number;
  thisRoundGross: number;
  cumulativeRetention: number;
  billingNumber: number;
  sourceKind: 'base' | 'co';
  sourceLabel: string;
};

/**
 * Cumulative-% rollup for a progress draw:
 *   cumulative_billed = pct% × source value
 *   this_round_gross  = max(0, cumulative_billed − prior gross on track)
 *   cum_retention     = retention% × cumulative_billed
 * Returns null when the source has no value to bill against.
 */
export function computeProgressNumbers(
  source: ProgressSource | null,
  percentOfContract: string | number,
  retainagePercent: string | number,
): ProgressNumbers | null {
  if (!source || source.value <= 0) return null;
  const contract = source.value;
  const pct = Number(percentOfContract) || 0;
  const retentionPct = Number(retainagePercent) || 0;
  const cumulativeBilled = (pct / 100) * contract;
  const thisRoundGross = Math.max(0, cumulativeBilled - source.priorGross);
  const cumulativeRetention = (retentionPct / 100) * cumulativeBilled;
  return {
    contract,
    pct,
    priorGross: source.priorGross,
    priorNet: source.priorNet,
    priorCount: source.priorCount,
    retentionPct,
    cumulativeBilled: Math.round(cumulativeBilled * 100) / 100,
    thisRoundGross: Math.round(thisRoundGross * 100) / 100,
    cumulativeRetention: Math.round(cumulativeRetention * 100) / 100,
    billingNumber: source.priorCount + 1,
    sourceKind: source.kind,
    sourceLabel: source.label,
  };
}
