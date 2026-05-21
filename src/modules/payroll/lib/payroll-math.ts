// =====================================================================
// Compute a weekly paystub for one employee from their employment type,
// stored pay rate, time entries for the period, and any manual override.
//
// Gross calculation precedence (first match wins):
//   1. Manual period_pay_override for this (employee, period) → use it.
//   2. Hourly with stored rate > 0 → sum(hours_logged) × hourly rate.
//   3. Salaried with stored rate > 0 → weekly rate.
//   4. Piecework / Contract / Commission / Lump sum without override → $0
//      (must be entered each period via the Pay Run tab).
//
// NIB exemption (nibExempt = true):
//   - No employee NIB withheld.
//   - No employer NIB owed.
//   - Excluded from the C10 summary entirely (filed return only covers
//     NIB-eligible employees).
//
// Inclusion rules:
//   - Terminated before period start → never include.
//   - Inactive AND no entries this period → exclude (don't pay a
//     deactivated employee who didn't log anything).
//   - Termination during the period: included at full pay; proration is
//     a follow-up phase if needed.
// =====================================================================

import { add, multiply, parseMoney, round2, subtract } from '@/lib/money';
import type {
  Employee,
  PayPeriod,
  PeriodPayOverride,
  TimeEntry,
} from '@/db/schema';
import type { EmploymentType } from '@/modules/employees/schema';
import { calculateWeeklyNib, type NibBreakdown } from './nib';

/** Where the paystub's gross came from. Drives UI hints (e.g. "Override"
 *  badge on the card) and tells the user what to edit if the number is
 *  wrong. */
export type GrossSource = 'override' | 'rate' | 'none';

export type EmployeePaystub = {
  employeeId: string;
  employeeName: string;
  employmentType: EmploymentType;
  hoursWorked: number;
  payRate: number;
  gross: number;
  grossSource: GrossSource;
  nib: NibBreakdown;
  /** True if NIB calculations were skipped because nibExempt is set. */
  nibExempt: boolean;
  /** Net pay = gross - employee NIB. (Employer NIB never reduces net.) */
  net: number;
  /** True if no entries AND the employee wasn't expected to be paid this period. */
  skipped: boolean;
  /** Optional explanation when skipped is true. */
  skipReason?: string;
};

export type C10Summary = {
  /** Number of employees represented on this period's filing. */
  headcount: number;
  /** Sum of gross pay across all employees. */
  totalGross: number;
  /** Sum of insurable wages (per-employee gross capped at $810). */
  totalInsurableWage: number;
  /** Total employee NIB withheld this period. */
  totalEmployee: number;
  /** Total employer NIB owed this period. */
  totalEmployer: number;
  /** Total amount to remit to NIB this period. */
  totalRemittance: number;
};

function shouldIncludeEmployee(
  employee: Employee,
  period: PayPeriod,
  hasEntries: boolean,
): { include: boolean; reason?: string } {
  // Terminated before the period started → never include.
  if (employee.terminationDate && employee.terminationDate < period.startDate) {
    return { include: false, reason: 'Terminated before period start' };
  }
  // Inactive AND no entries → exclude (don't pay a deactivated employee
  // who didn't log anything). Inactive WITH entries → still include so
  // the recorded work gets paid; reactivation issues surface that way.
  if (!employee.active && !hasEntries) {
    return { include: false, reason: 'Inactive · no entries this period' };
  }
  return { include: true };
}

/**
 * Compute gross pay from rate + hours when no manual override is set.
 * Hourly multiplies hours × rate; salaried pays the weekly rate;
 * piecework / contract / commission / lump_sum without a manual override
 * pay zero (must be entered via Pay Run).
 *
 * Returns {gross, source} so the paystub can label the number with where
 * it came from.
 */
function computeRateGross(
  employmentType: EmploymentType,
  payRate: number,
  hoursWorked: number,
): { gross: number; source: GrossSource } {
  if (employmentType === 'hourly') {
    const gross = multiply(hoursWorked, payRate);
    return { gross, source: gross > 0 ? 'rate' : 'none' };
  }
  if (employmentType === 'salaried') {
    const gross = round2(payRate);
    return { gross, source: gross > 0 ? 'rate' : 'none' };
  }
  // Piecework / contract / commission / lump_sum: no auto-pay without an
  // override. User must enter gross via Pay Run.
  return { gross: 0, source: 'none' };
}

/** Compute the paystub for one employee for one weekly period. */
export function computeEmployeePaystub(
  employee: Employee,
  entries: TimeEntry[],
  period: PayPeriod,
  overrides: PeriodPayOverride[],
): EmployeePaystub {
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
  const employmentType = employee.employmentType as EmploymentType;
  const payRate = parseMoney(employee.payRate);
  const nibExempt = employee.nibExempt === true;

  const myEntries = entries.filter((e) => e.employeeId === employee.id);
  const hoursWorked = round2(
    myEntries.reduce((sum, e) => sum + parseMoney(e.hours), 0),
  );
  const myOverride = overrides.find(
    (o) => o.employeeId === employee.id && o.payPeriodId === period.id,
  );
  const hasOverride = myOverride !== undefined;

  const eligibility = shouldIncludeEmployee(
    employee,
    period,
    myEntries.length > 0 || hasOverride,
  );
  if (!eligibility.include) {
    return {
      employeeId: employee.id,
      employeeName,
      employmentType,
      hoursWorked,
      payRate,
      gross: 0,
      grossSource: 'none',
      nib: calculateWeeklyNib(0),
      nibExempt,
      net: 0,
      skipped: true,
      skipReason: eligibility.reason,
    };
  }

  // Override always wins. Otherwise compute from rate.
  let gross: number;
  let grossSource: GrossSource;
  if (myOverride) {
    gross = parseMoney(myOverride.grossAmount);
    grossSource = 'override';
  } else {
    const computed = computeRateGross(employmentType, payRate, hoursWorked);
    gross = computed.gross;
    grossSource = computed.source;
  }

  // NIB exemption short-circuits the whole NIB block to zero. The C10
  // summary later filters by !nibExempt so exempt employees don't roll
  // into the filed totals.
  const nib = nibExempt
    ? calculateWeeklyNib(0)
    : calculateWeeklyNib(gross);
  const net = subtract(gross, nib.employee);

  return {
    employeeId: employee.id,
    employeeName,
    employmentType,
    hoursWorked,
    payRate,
    gross,
    grossSource,
    nib,
    nibExempt,
    net,
    skipped: false,
  };
}

/** Compute all paystubs for a period, sorted by employee name. */
export function computePeriodPaystubs(
  employees: Employee[],
  entries: TimeEntry[],
  period: PayPeriod,
  overrides: PeriodPayOverride[],
): EmployeePaystub[] {
  return employees
    .map((e) => computeEmployeePaystub(e, entries, period, overrides))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/**
 * Aggregate paystubs into the C10-filing summary. NIB-exempt employees
 * are excluded entirely — the C10 only covers NIB-eligible workers, so
 * an exempt employee's gross wouldn't show up on the filed return.
 */
export function computeC10Summary(paystubs: EmployeePaystub[]): C10Summary {
  let headcount = 0;
  let totalGross = 0;
  let totalInsurableWage = 0;
  let totalEmployee = 0;
  let totalEmployer = 0;
  for (const p of paystubs) {
    if (p.skipped || p.gross <= 0) continue;
    if (p.nibExempt) continue;
    headcount += 1;
    totalGross = add(totalGross, p.gross);
    totalInsurableWage = add(totalInsurableWage, p.nib.insurableWage);
    totalEmployee = add(totalEmployee, p.nib.employee);
    totalEmployer = add(totalEmployer, p.nib.employer);
  }
  return {
    headcount,
    totalGross,
    totalInsurableWage,
    totalEmployee,
    totalEmployer,
    totalRemittance: add(totalEmployee, totalEmployer),
  };
}
