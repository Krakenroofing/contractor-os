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
  PaystubAdjustment,
  PeriodPayOverride,
  PeriodPaystubSnapshot,
  TimeEntry,
  TimesheetLunchOverride,
} from '@/db/schema';
import type { AdjustmentType } from '@/db/schema';
import type { EmploymentType } from '@/modules/employees/schema';
import { calculateWeeklyNib, type NibBreakdown } from './nib';
import { effectiveLunchMinutes } from './lunch';
import { computeHourlyOvertime } from './overtime';
import { bahamasHolidaySet } from './holidays';

/** Where the paystub's gross came from. Drives UI hints (e.g. "Override"
 *  badge on the card) and tells the user what to edit if the number is
 *  wrong. */
export type GrossSource = 'override' | 'rate' | 'none';

/** A single paystub line item — surfaces on the stub with its
 *  description and amount, grouped by category. */
export type PaystubLineItem = {
  id: string;
  type: AdjustmentType;
  amount: number;
  description: string | null;
};

export type EmployeePaystub = {
  employeeId: string;
  employeeName: string;
  employmentType: EmploymentType;
  /** PAID hours — gross logged hours minus unpaid lunch. */
  hoursWorked: number;
  /** Unpaid lunch hours deducted across the period (for display). */
  lunchHours: number;
  /** Hours paid at 1.5× (over 40/week). Hourly only; 0 otherwise. */
  overtimeHours: number;
  /** Hours paid at 2× (holiday / qualifying Sunday). Hourly only. */
  doubleTimeHours: number;
  payRate: number;
  /** Pre-deduction gross (rate × hours, weekly salary, or override). */
  gross: number;
  grossSource: GrossSource;
  /** Optional pay-description text for this period (from the override
   *  row's notes column). Prints on the stub like a slip / check memo
   *  line so contract employees can see what they were paid for. */
  payDescription: string | null;
  /** Deductions reduce gross BEFORE NIB. See
   *  [[project-payroll-deductions-pre-nib]]. */
  deductions: PaystubLineItem[];
  /** Additions (reimbursement / per_diem / expense) added to net post-NIB. */
  additions: PaystubLineItem[];
  /** Adjusted gross = gross − sum(deductions). NIB calculates off this. */
  adjustedGross: number;
  /** Sum of deduction line items. */
  deductionsTotal: number;
  /** Sum of addition line items (reimbursement + per_diem + expense). */
  additionsTotal: number;
  nib: NibBreakdown;
  /** True if NIB calculations were skipped because nibExempt is set. */
  nibExempt: boolean;
  /** Net pay = adjusted_gross − employee NIB + additions. */
  net: number;
  /** True if no entries AND the employee wasn't expected to be paid this period. */
  skipped: boolean;
  /** Optional explanation when skipped is true. */
  skipReason?: string;
};

export type C10Summary = {
  /** Number of employees represented on this period's filing. */
  headcount: number;
  /** Sum of adjusted (post-deduction) gross pay across all employees —
   *  this is what NIB applies to and what gets filed on the C-10. */
  totalGross: number;
  /** Sum of insurable wages (per-employee adjusted gross capped at $810). */
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

/** Sum a subset of adjustments by type predicate. */
function sumAdjustments(
  adjustments: PaystubAdjustment[],
  predicate: (a: PaystubAdjustment) => boolean,
): number {
  return round2(
    adjustments
      .filter(predicate)
      .reduce((sum, a) => sum + parseMoney(a.amount), 0),
  );
}

function adjustmentToLineItem(a: PaystubAdjustment): PaystubLineItem {
  return {
    id: a.id,
    type: a.type as AdjustmentType,
    amount: parseMoney(a.amount),
    description: a.description,
  };
}

/** Compute the paystub for one employee for one weekly period. */
export function computeEmployeePaystub(
  employee: Employee,
  entries: TimeEntry[],
  period: PayPeriod,
  overrides: PeriodPayOverride[],
  adjustments: PaystubAdjustment[] = [],
  lunchOverrides: TimesheetLunchOverride[] = [],
): EmployeePaystub {
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
  const employmentType = employee.employmentType as EmploymentType;
  const payRate = parseMoney(employee.payRate);
  const nibExempt = employee.nibExempt === true;

  const myEntries = entries.filter((e) => e.employeeId === employee.id);
  // Group 'hours' rows by work date so the unpaid lunch (which is per-day,
  // not per-entry) comes off each day's total. 'amount' rows are pay events,
  // not time worked, so they don't count toward hours.
  const hoursByDate = new Map<string, number>();
  for (const e of myEntries) {
    if (e.entryType === 'amount') continue;
    hoursByDate.set(
      e.workDate,
      (hoursByDate.get(e.workDate) ?? 0) + parseMoney(e.hours),
    );
  }
  const lunchByDate = new Map(
    lunchOverrides
      .filter((l) => l.employeeId === employee.id)
      .map((l) => [l.workDate, l.minutes]),
  );
  // Net (paid) hours per day, after the unpaid lunch — the input both to the
  // hours total and to the overtime tiers.
  const netHoursByDate = new Map<string, number>();
  let grossHours = 0;
  for (const [workDate, dayHours] of hoursByDate) {
    grossHours += dayHours;
    const lunchMin = effectiveLunchMinutes(dayHours, lunchByDate.get(workDate));
    netHoursByDate.set(workDate, Math.max(0, dayHours - lunchMin / 60));
  }
  const paidHours = [...netHoursByDate.values()].reduce((a, b) => a + b, 0);
  const hoursWorked = round2(paidHours);
  const lunchHours = round2(grossHours - paidHours);
  const amountTotal = round2(
    myEntries
      .filter((e) => e.entryType === 'amount')
      .reduce((sum, e) => sum + parseMoney(e.amount), 0),
  );
  const myOverride = overrides.find(
    (o) => o.employeeId === employee.id && o.payPeriodId === period.id,
  );
  const hasOverride = myOverride !== undefined;
  const myAdjustments = adjustments
    .filter((a) => a.employeeId === employee.id && a.payPeriodId === period.id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const deductions = myAdjustments
    .filter((a) => a.type === 'deduction')
    .map(adjustmentToLineItem);
  const additions = myAdjustments
    .filter((a) => a.type !== 'deduction')
    .map(adjustmentToLineItem);
  const deductionsTotal = sumAdjustments(
    myAdjustments,
    (a) => a.type === 'deduction',
  );
  const additionsTotal = sumAdjustments(
    myAdjustments,
    (a) => a.type !== 'deduction',
  );

  const hasAnyActivity =
    myEntries.length > 0 || hasOverride || myAdjustments.length > 0;
  const eligibility = shouldIncludeEmployee(employee, period, hasAnyActivity);
  if (!eligibility.include) {
    return {
      employeeId: employee.id,
      employeeName,
      employmentType,
      hoursWorked,
      lunchHours,
      overtimeHours: 0,
      doubleTimeHours: 0,
      payRate,
      gross: 0,
      grossSource: 'none',
      payDescription: null,
      deductions: [],
      additions: [],
      adjustedGross: 0,
      deductionsTotal: 0,
      additionsTotal: 0,
      nib: calculateWeeklyNib(0),
      nibExempt,
      net: 0,
      skipped: true,
      skipReason: eligibility.reason,
    };
  }

  // Override always wins. Hourly runs the overtime engine (1.5× over 40h/wk,
  // 2× for a holiday or a Sunday after a full Mon–Sat); other types use the
  // flat rate/amount rule.
  let gross: number;
  let grossSource: GrossSource;
  let overtimeHours = 0;
  let doubleTimeHours = 0;
  if (myOverride) {
    gross = parseMoney(myOverride.grossAmount);
    grossSource = 'override';
  } else if (employmentType === 'hourly') {
    const years = Array.from(
      new Set([
        Number(period.startDate.slice(0, 4)),
        Number(period.endDate.slice(0, 4)),
      ]),
    );
    const ot = computeHourlyOvertime(
      netHoursByDate,
      period.startDate,
      bahamasHolidaySet(years),
      payRate,
    );
    overtimeHours = ot.overtimeHours;
    doubleTimeHours = ot.doubleTimeHours;
    // Piece-work (amount entries) adds on top of the hourly/OT pay — anyone
    // can log contract work on a day regardless of their employment type.
    gross = round2(ot.gross + amountTotal);
    grossSource = gross > 0 ? 'rate' : 'none';
  } else {
    const computed = computeRateGross(
      employmentType,
      payRate,
      hoursWorked,
      amountTotal,
    );
    // Salaried gets weekly pay PLUS any piece-work amounts; variable-pay
    // types are already the sum of their amounts.
    gross =
      employmentType === 'salaried'
        ? round2(computed.gross + amountTotal)
        : computed.gross;
    grossSource = gross > 0 ? 'rate' : computed.source;
  }

  // Deductions reduce gross BEFORE NIB. NIB then calculates off the
  // adjusted (post-deduction) gross. Reimbursements / per_diem / expenses
  // bypass NIB entirely and are added to net after withholding.
  const adjustedGross = Math.max(0, round2(subtract(gross, deductionsTotal)));

  // NIB exemption short-circuits the whole NIB block to zero. The C10
  // summary later filters by !nibExempt so exempt employees don't roll
  // into the filed totals.
  // NIB ceiling is date-dependent (e.g. the 2026-07-01 increase) — pass the
  // period end date so the right cap applies.
  const nib = nibExempt
    ? calculateWeeklyNib(0, period.endDate)
    : calculateWeeklyNib(adjustedGross, period.endDate);
  const net = round2(
    subtract(adjustedGross, nib.employee) + additionsTotal,
  );

  return {
    employeeId: employee.id,
    employeeName,
    employmentType,
    hoursWorked,
    lunchHours,
    overtimeHours,
    doubleTimeHours,
    payRate,
    gross,
    grossSource,
    payDescription: myOverride?.notes ?? null,
    deductions,
    additions,
    adjustedGross,
    deductionsTotal,
    additionsTotal,
    nib,
    nibExempt,
    net,
    skipped: false,
  };
}

/**
 * Reconstruct a paystub from a frozen snapshot row. Used for locked
 * periods so rate changes after lock-time don't rewrite history.
 *
 * Line items (deductions / additions) aren't snapshotted as rows — they
 * live in paystub_adjustments and are filtered to the locked period.
 * The data layer prevents mutating adjustments on a locked period, so
 * the snapshot totals stay in sync with the live rows.
 */
function paystubFromSnapshot(
  snap: PeriodPaystubSnapshot,
  overrides: PeriodPayOverride[],
  adjustments: PaystubAdjustment[],
): EmployeePaystub {
  const gross = parseMoney(snap.gross);
  // adjustedGross / deductionsTotal / additionsTotal default to '0' from
  // the migration. Pre-Phase-4.10 snapshots will read deductionsTotal=0
  // and adjustedGross = gross (set by the migration's UPDATE).
  const adjustedGross =
    parseMoney(snap.adjustedGross) > 0
      ? parseMoney(snap.adjustedGross)
      : gross;
  const deductionsTotal = parseMoney(snap.deductionsTotal);
  const additionsTotal = parseMoney(snap.additionsTotal);
  const insurableWage = parseMoney(snap.insurableWage);
  const employeeNib = parseMoney(snap.employeeNib);
  const employerNib = parseMoney(snap.employerNib);

  const myOverride = overrides.find(
    (o) => o.employeeId === snap.employeeId && o.payPeriodId === snap.payPeriodId,
  );
  const myAdjustments = adjustments
    .filter(
      (a) =>
        a.employeeId === snap.employeeId && a.payPeriodId === snap.payPeriodId,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const deductions = myAdjustments
    .filter((a) => a.type === 'deduction')
    .map(adjustmentToLineItem);
  const additions = myAdjustments
    .filter((a) => a.type !== 'deduction')
    .map(adjustmentToLineItem);

  return {
    employeeId: snap.employeeId,
    employeeName: snap.employeeName,
    employmentType: snap.employmentType as EmploymentType,
    // Snapshot hoursWorked is already net of lunch (lunch was applied before
    // the period was locked); no separate lunch line to reconstruct.
    hoursWorked: parseMoney(snap.hoursWorked),
    lunchHours: 0,
    overtimeHours: 0,
    doubleTimeHours: 0,
    payRate: parseMoney(snap.payRate),
    gross,
    grossSource: (snap.grossSource as GrossSource) ?? 'none',
    payDescription: myOverride?.notes ?? null,
    deductions,
    additions,
    adjustedGross,
    deductionsTotal,
    additionsTotal,
    nib: {
      gross: adjustedGross,
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
  adjustments: PaystubAdjustment[] = [],
  lunchOverrides: TimesheetLunchOverride[] = [],
): EmployeePaystub[] {
  if (period.status === 'locked' && snapshots.length > 0) {
    return snapshots
      .map((s) => paystubFromSnapshot(s, overrides, adjustments))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }
  return employees
    .map((e) =>
      computeEmployeePaystub(
        e,
        entries,
        period,
        overrides,
        adjustments,
        lunchOverrides,
      ),
    )
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
    // Filed wages are POST-deduction (adjusted gross). Skip rows that
    // come out to zero after deductions — they wouldn't appear on the
    // C-10. See [[project-payroll-deductions-pre-nib]].
    if (p.skipped || p.adjustedGross <= 0) continue;
    if (p.nibExempt) continue;
    headcount += 1;
    totalGross = add(totalGross, p.adjustedGross);
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
