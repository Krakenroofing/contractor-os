// Unpaid lunch-break rule. Bahamas practice: a day with >= 6 hours worked gets
// a 60-minute unpaid lunch, a shorter day (under 6h, but worked) gets 30, and a
// day with no hours gets none. This default is overridable per (employee, day).

export function lunchDefaultMinutes(dayHours: number): number {
  if (dayHours >= 6) return 60;
  if (dayHours > 0) return 30;
  return 0;
}

/** The lunch minutes that actually apply for a day: an explicit override when
 *  set (including 0 = "no lunch"), otherwise the hours-based default. */
export function effectiveLunchMinutes(
  dayHours: number,
  overrideMinutes: number | null | undefined,
): number {
  return overrideMinutes ?? lunchDefaultMinutes(dayHours);
}
