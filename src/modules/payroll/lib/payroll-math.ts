// =====================================================================
// Compute a weekly paystub for one employee from their pay rate +
// employment type + the time entries logged inside a pay period.
//
// Gross calculation by type:
//   - Hourly: sum(hours_logged) × hourly rate.
//   - Salaried: weekly salary, regardless of hours logged.
//   - Piecework / Contract / Commission / Lump sum: flat pay_rate per
//     period for now. Per-type math (pieces × rate, % of sales, etc.)
//     can refine these in a follow-up phase. Edit pay_rate to whatever
//     the employee is owed this period.
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
import type { Employee, PayPeriod, TimeEntry } from '@/db/schema';
import type { EmploymentType } from '@/modules/employees/schema';
import { calculateWeeklyNib, type NibBreakdown } from './nib';

export type EmployeePaystub = {
  employeeId: string;
  employeeName: string;
  employmentType: EmploymentType;
  hoursWorked: number;
  payRate: number;
  gross: number;
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
 * Compute gross pay for one employee for one weekly period based on
 * their employment type. Hourly multiplies hours × rate; every other
 * type pays the stored rate as a flat per-period amount.
 */
function computeGross(
  employmentType: EmploymentType,
  payRate: number,
  hoursWorked: number,
): number {
  if (employmentType === 'hourly') {
    return multiply(hoursWorked, payRate);
  }
  // Salaried / piecework / contract / commission / lump_sum: pay_rate is
  // already "amount per period" — return it as the gross. Future phases
  // can refine per-type math (pieces × rate, % of sales, etc.).
  return round2(payRate);
}

/** Compute the paystub for one employee for one weekly period. */
export function computeEmployeePaystub(
  employee: Employee,
  entries: TimeEntry[],
  period: PayPeriod,
): EmployeePaystub {
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
  const employmentType = employee.employmentType as EmploymentType;
  const payRate = parseMoney(employee.payRate);
  const nibExempt = employee.nibExempt === true;

  const myEntries = entries.filter((e) => e.employeeId === employee.id);
  const hoursWorked = round2(
    myEntries.reduce((sum, e) => sum + parseMoney(e.hours), 0),
  );

  const eligibility = shouldIncludeEmployee(employee, period, myEntries.length > 0);
  if (!eligibility.include) {
    return {
      employeeId: employee.id,
      employeeName,
      employmentType,
      hoursWorked,
      payRate,
      gross: 0,
      nib: calculateWeeklyNib(0),
      nibExempt,
      net: 0,
      skipped: true,
      skipReason: eligibility.reason,
    };
  }

  const gross = computeGross(employmentType, payRate, hoursWorked);

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
): EmployeePaystub[] {
  return employees
    .map((e) => computeEmployeePaystub(e, entries, period))
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
