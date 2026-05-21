// =====================================================================
// Compute a weekly paystub for one employee from their pay rate +
// employment type + the time entries logged inside a pay period.
//
// Rules:
//   - Hourly: gross = sum(hours) × hourly rate.
//   - Salaried: gross = weekly salary, regardless of hours logged. (Hours
//     are still tracked for job-costing but don't change the paycheck.)
//   - An employee is INCLUDED in payroll for the period unless they were
//     terminated strictly before the period starts. Termination during
//     the period: included at full pay; manual proration via notes if
//     needed (Phase 5 polish item).
//   - Inactive employees (active=false) are excluded unless they logged
//     time in the period — protects against accidentally paying someone
//     who was deactivated but still has open hours.
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
  /** Net pay = gross - employee NIB. (Employer NIB never reduces net.) */
  net: number;
  /** True if no entries AND the employee wasn't expected to be paid this period. */
  skipped: boolean;
  /** Optional explanation when skipped is true. */
  skipReason?: string;
};

export type C17Summary = {
  /** Number of employees represented on this period's filing. */
  headcount: number;
  /** Sum of gross pay across all employees. */
  totalGross: number;
  /** Sum of insurable wages (per-employee gross capped at $710). */
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

/** Compute the paystub for one employee for one weekly period. */
export function computeEmployeePaystub(
  employee: Employee,
  entries: TimeEntry[],
  period: PayPeriod,
): EmployeePaystub {
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
  const employmentType = employee.employmentType as EmploymentType;
  const payRate = parseMoney(employee.payRate);

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
      net: 0,
      skipped: true,
      skipReason: eligibility.reason,
    };
  }

  // Hourly = hours × rate. Salaried = the weekly pay rate, full stop.
  const gross =
    employmentType === 'salaried'
      ? round2(payRate)
      : multiply(hoursWorked, payRate);

  const nib = calculateWeeklyNib(gross);
  const net = subtract(gross, nib.employee);

  return {
    employeeId: employee.id,
    employeeName,
    employmentType,
    hoursWorked,
    payRate,
    gross,
    nib,
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

/** Aggregate paystubs into the C17-filing summary. */
export function computeC17Summary(paystubs: EmployeePaystub[]): C17Summary {
  let headcount = 0;
  let totalGross = 0;
  let totalInsurableWage = 0;
  let totalEmployee = 0;
  let totalEmployer = 0;
  for (const p of paystubs) {
    if (p.skipped || p.gross <= 0) continue;
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
