// =====================================================================
// Compute a weekly paystub for one employee from their employment type,
// stored pay rate, time entries for the period, and any manual override.
//
// time_entries carry an entry_type — 'hours' rows are the classic
// timesheet shape (hours × rate), 'amount' rows are direct pay events
// used for piecework / contract / commission / lump-sum employees. Both
// types live in the same table; the math layer reads only the field
// that matches the row's type.
//
// Gross calculation precedence (first match wins):
//   1. Manual period_pay_override for this (employee, period) → use it.
//   2. Hourly with stored rate > 0 → sum(hours rows) × hourly rate.
//   3. Salaried with stored rate > 0 → weekly rate.
//   4. Piecework / Contract / Commission / Lump sum → sum(amount rows)
//      for the period. If no amount entries exist yet → $0 (still needs
//      entry via timesheet or Pay Run).
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
  PeriodPaystubSnapshot,
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
 * Compute gross pay from rate + hours + amount-entries when no manual
 * override is set. Hourly = hours × rate. Salaried = weekly rate.
 * Piecework / contract / commission / lump_sum = sum of amount entries
 * logged this period.
 *
 * Returns {gross, source} so the paystub can label the number with where
 * it came from.
 */
function computeRateGross(
  employmentType: EmploymentType,
  payRate: number,
  hoursWorked: number,
  amountTotal: number,
): { gross: number; source: GrossSource } {
  if (employmentType === 'hourly') {
    const gross = multiply(hoursWorked, payRate);
    return { gross, source: gross > 0 ? 'rate' : 'none' };
  }
  if (employmentType === 'salaried') {
    const gross = round2(payRate);
    return { gross, source: gross > 0 ? 'rate' : 'none' };
  }
  // Piecework / contract / commission / lump_sum: gross is the sum of
  // direct pay entries (entry_type='amount') logged this period.
  return {
    gross: round2(amountTotal),
    source: amountTotal > 0 ? 'rate' : 'none',
  };
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
  // Only 'hours' rows contribute to hoursWorked; 'amount' rows are pay
  // events, not time worked, so they don't sum here.
  const hoursWorked = round2(
    myEntries
      .filter((e) => e.entryType !== 'amount')
      .reduce((sum, e) => sum + parseMoney(e.hours), 0),
  );
  const amountTotal = round2(
    myEntries
      .filter((e) => e.entryType === 'amount')
      .reduce((sum, e) => sum + parseMoney(e.amount), 0),
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

  // Override always wins. Otherwise compute from rate + entries.
  let gross: number;
  let grossSource: GrossSource;
  if (myOverride) {
    gross = parseMoney(myOverride.grossAmount);
    grossSource = 'override';
  } else {
    const computed = computeRateGross(
      employmentType,
      payRate,
      hoursWorked,
      amountTotal,
    );
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

/**
 * Reconstruct a paystub from a frozen snapshot row. Used for locked
 * periods so rate changes after lock-time don't rewrite history.
 */
function paystubFromSnapshot(snap: PeriodPaystubSnapshot): EmployeePaystub {
  const gross = parseMoney(snap.gross);
  const insurableWage = parseMoney(snap.insurableWage);
  const employeeNib = parseMoney(snap.employeeNib);
  const employerNib = parseMoney(snap.employerNib);
  return {
    employeeId: snap.employeeId,
    employeeName: snap.employeeName,
    employmentType: snap.employmentType as EmploymentType,
    hoursWorked: parseMoney(snap.hoursWorked),
    payRate: parseMoney(snap.payRate),
    gross,
    grossSource: (snap.grossSource as GrossSource) ?? 'none',
    nib: {
      gross,
      insurableWage,
      employee: employeeNib,
      employer: employerNib,
      total: round2(employeeNib + employerNib),
    },
    nibExempt: snap.nibExempt,
    net: parseMoney(snap.net),
    skipped: false,
  };
}

/**
 * Compute all paystubs for a period, sorted by employee name.
 *
 * When the period is locked AND a snapshot set exists, paystubs are
 * reconstructed from snapshots — the live employee.pay_rate is ignored,
 * which is the entire point of locking. When the period is open (or
 * locked but has no snapshots, e.g. legacy data), paystubs compute
 * live as before.
 */
export function computePeriodPaystubs(
  employees: Employee[],
  entries: TimeEntry[],
  period: PayPeriod,
  overrides: PeriodPayOverride[],
  snapshots: PeriodPaystubSnapshot[] = [],
): EmployeePaystub[] {
  if (period.status === 'locked' && snapshots.length > 0) {
    return snapshots
      .map(paystubFromSnapshot)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }
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
