// Pure VAT-split math, shared by the transaction-row form (client) and the
// banking-rule engine (server). No I/O, no `server-only` import — mirrors the
// design of lib/rules.ts so both runtimes use one source of truth.

export const round2 = (n: number) => Math.round(n * 100) / 100;

export type VatSplit = { net: number; vat: number };

/**
 * Split a VAT-inclusive gross amount into its net (ex-VAT) and VAT portions at
 * `ratePercent`. e.g. gross 110 @ 10% → { net: 100, vat: 10 }. The two parts
 * always sum back to `gross` to the cent (VAT is the remainder, never rounded
 * independently). A non-positive or non-finite rate yields zero VAT.
 */
export function computeVatSplit(gross: number, ratePercent: number): VatSplit {
  if (
    !Number.isFinite(gross) ||
    !Number.isFinite(ratePercent) ||
    ratePercent <= 0
  ) {
    return { net: round2(gross), vat: 0 };
  }
  const net = round2(gross / (1 + ratePercent / 100));
  const vat = round2(gross - net);
  return { net, vat };
}
