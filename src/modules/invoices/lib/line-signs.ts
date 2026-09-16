// Sign handling for invoice line items that are meant to SUBTRACT.
//
// "+ Add credit / deduction" and "+ Add project credit" seed a line whose job
// is to reduce the invoice. Nothing used to enforce that: the operator typed
// a plain amount, the line added, and the invoice quietly came out too high
// (a "Less 318.20" line that pushed the total UP by 318.20 instead of down).
// These helpers keep such a row negative whatever is typed into it.
//
// Client-only concern — nothing here is persisted. A saved line is a
// deduction because its stored amount is negative, which is how the forms
// read it back in.

export function isSubtractingLine(l: {
  isDeduction?: boolean;
  isProjectCredit?: boolean;
}): boolean {
  return Boolean(l.isDeduction || l.isProjectCredit);
}

/**
 * Keep a subtracting row's unit cost negative whatever the operator types;
 * leave a normal row's input untouched.
 *
 * Works on the raw input string (not a number) so partial typing still feels
 * normal: "", "-", and "3." pass straight through.
 */
export function signUnitCost(raw: string, subtracting: boolean): string {
  if (!subtracting) return raw;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return trimmed;
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n)) return raw;
  return n > 0 ? `-${trimmed.replace(/^\+/, '')}` : trimmed;
}
