// =====================================================================
// Bahamas NIB (National Insurance Board) contribution calculator.
//
// Rates and ceilings below come from the **Non-Hospitality Form C-10**
// (the monthly employer contribution schedule filed with NIB). Verified
// 2026-05-21 against a current form provided by Chris @ Kraken Roofing.
// When NIB updates these, change them here and every paystub + C10
// summary across the codebase picks up the new values.
//
// Form filed with NIB:
//   - **Non-Hospitality C-10** (this calculator) — most employers.
//   - There is also a **Hospitality C-10** with different rates for the
//     hotel / restaurant industry. Not handled here yet; if Kraken takes
//     on hospitality work we'll need a per-employee NIB-mode flag.
// =====================================================================

import { multiply, round2 } from '@/lib/money';

export const NIB_RATES = {
  /** Employee contribution rate, deducted from gross (Non-Hospitality). */
  employeeRate: 0.0465, // 4.65%
  /** Employer contribution rate, paid by the company (Non-Hospitality). */
  employerRate: 0.0665, // 6.65%
  /** As-of date when these rates were last verified against an actual form. */
  effectiveAsOf: '2026-06-29',
} as const;

/**
 * Insurable-wage ceilings, newest first. NIB raises these periodically; the
 * one in force for a pay period is the most recent whose `effectiveFrom` is on
 * or before the period's date.
 *
 *   - 2026-07-01: weekly $810 → $830, monthly $3,510 → $3,597 (rates unchanged;
 *     high earners just pay the same % on $20 more of weekly wage).
 *   - (prior): weekly $810, monthly $3,510.
 *
 * monthlyWageCeiling ≈ weeklyWageCeiling × 52 / 12 — NIB prints it on the C-10;
 * weekly payroll uses the weekly cap directly.
 */
export const NIB_CEILING_SCHEDULE = [
  { effectiveFrom: '2026-07-01', weeklyWageCeiling: 830, monthlyWageCeiling: 3597 },
  { effectiveFrom: '1970-01-01', weeklyWageCeiling: 810, monthlyWageCeiling: 3510 },
] as const;

export type NibCeiling = {
  weeklyWageCeiling: number;
  monthlyWageCeiling: number;
};

/**
 * The insurable-wage ceiling in force for a pay period, by its date
 * (YYYY-MM-DD). Falls back to the latest ceiling when no/invalid date is given
 * (e.g. a zero-gross stub where the cap is irrelevant anyway).
 */
export function nibCeilingForDate(periodDate?: string | null): NibCeiling {
  const d =
    typeof periodDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(periodDate)
      ? periodDate.slice(0, 10)
      : null;
  const hit = d
    ? NIB_CEILING_SCHEDULE.find((c) => d >= c.effectiveFrom)
    : undefined;
  const c = hit ?? NIB_CEILING_SCHEDULE[0];
  return {
    weeklyWageCeiling: c.weeklyWageCeiling,
    monthlyWageCeiling: c.monthlyWageCeiling,
  };
}

export type NibBreakdown = {
  /** Gross pay before any deduction. */
  gross: number;
  /** Portion of gross subject to NIB — capped at weeklyWageCeiling. */
  insurableWage: number;
  /** Employee NIB withheld (insurableWage × employeeRate). */
  employee: number;
  /** Employer NIB owed (insurableWage × employerRate). */
  employer: number;
  /** Total NIB remitted to the government this period (employee + employer). */
  total: number;
};

/**
 * Compute NIB contributions for one employee for one weekly pay period.
 * Pure function — no I/O, no DB. Inputs in dollars, outputs in dollars
 * rounded to 2 decimals.
 *
 * The ceiling is applied per-pay-period and depends on the period's date
 * (`periodDate`, YYYY-MM-DD) — the 2026-07-01 increase to $830/week applies to
 * periods on or after that date. If gross exceeds the weekly cap, only the cap
 * is subject to NIB.
 */
export function calculateWeeklyNib(
  gross: number,
  periodDate?: string | null,
): NibBreakdown {
  const safeGross = Number.isFinite(gross) && gross > 0 ? round2(gross) : 0;
  const { weeklyWageCeiling } = nibCeilingForDate(periodDate);
  const insurableWage = Math.min(safeGross, weeklyWageCeiling);
  const employee = multiply(insurableWage, NIB_RATES.employeeRate);
  const employer = multiply(insurableWage, NIB_RATES.employerRate);
  return {
    gross: safeGross,
    insurableWage,
    employee,
    employer,
    total: round2(employee + employer),
  };
}
