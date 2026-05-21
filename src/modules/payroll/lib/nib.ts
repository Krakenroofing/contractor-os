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
  /** Weekly insurable wage ceiling — wages above this cap are NIB-exempt. */
  weeklyWageCeiling: 810,
  /**
   * Monthly insurable wage ceiling on the C-10 itself. We don't use this
   * directly for weekly payroll (the weekly cap × Mondays-in-month is the
   * effective monthly cap), but it's the number NIB prints on the form
   * and the value we'd use if bi-weekly / monthly periods get added.
   */
  monthlyWageCeiling: 3510,
  /** As-of date when these rates were last verified against an actual form. */
  effectiveAsOf: '2026-05-21',
} as const;

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
 * The ceiling is applied per-pay-period. If gross exceeds the weekly
 * cap, only the cap is subject to NIB.
 */
export function calculateWeeklyNib(gross: number): NibBreakdown {
  const safeGross = Number.isFinite(gross) && gross > 0 ? round2(gross) : 0;
  const insurableWage = Math.min(safeGross, NIB_RATES.weeklyWageCeiling);
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
