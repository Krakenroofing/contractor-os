// Bahamas companies (e.g. TRB Ltd) charge VAT; US companies (e.g. Kraken
// Roofing LLC) don't. Reports must never say "VAT" for a non-VAT company — use
// this single source of truth so the label tracks company.isVatActive.
//
//   taxLabel(true)  => 'VAT'
//   taxLabel(false) => 'Tax'
export function taxLabel(isVatActive: boolean): string {
  return isVatActive ? 'VAT' : 'Tax';
}

/** "ex-VAT" / "ex-Tax" — the net-of-tax qualifier used throughout reports. */
export function exTaxLabel(isVatActive: boolean): string {
  return `ex-${taxLabel(isVatActive)}`;
}
