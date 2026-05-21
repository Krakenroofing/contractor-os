// =====================================================================
// Bahamas NIB (National Insurance Board) contribution calculator.
//
// Rates as of 2026-05-21 — verify against the latest NIB schedule before
// each filing run. When NIB updates these, change them here and every
// paystub / C17 summary across the codebase picks up the new values.
//
// Filed on the C17 form: employee + employer contributions are remitted
// monthly to NIB.
// =====================================================================

import { multiply, round2 } from '@/lib/money';

export const NIB_RATES = {
  /** Employee contribution rate (deducted from gross). */
  employeeRate: 0.039, // 3.9%
  /** Employer contribution rate (paid by the company, on top of gross). */
  employerRate: 0.059, // 5.9%
  /** Weekly insurable wage ceiling — wages above this cap are NIB-exempt. */
  weeklyWageCeiling: 710,
  /** As-of date when these rates were last verified. */
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
 * The ceiling is applied per-pay-period. If gross exceeds $710 in a
 * single week, only the first $710 is subject to NIB.
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
