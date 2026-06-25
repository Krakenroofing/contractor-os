import { NextRequest } from 'next/server';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { getOrCreatePeriodForDate } from '@/lib/data/pay-periods';
import { listEmployees } from '@/lib/data/employees';
import { listTimeEntries } from '@/lib/data/time-entries';
import { listPeriodPayOverrides } from '@/lib/data/period-pay-overrides';
import { listPaystubSnapshots } from '@/lib/data/period-paystub-snapshots';
import { listPaystubAdjustments } from '@/lib/data/paystub-adjustments';
import { listLunchOverrides } from '@/lib/data/timesheet-lunch';
import { computePeriodPaystubs } from '@/modules/payroll/lib/payroll-math';
import { mondayOf } from '@/modules/payroll/lib/periods';

export const dynamic = 'force-dynamic';

// Standard payroll register for a pay period — one row per paid employee with
// hours, gross, deductions, NIB, reimbursements/per-diem, and net pay, plus a
// totals row. Pulls from the same paystub computation as the on-screen view
// (locked periods read their frozen snapshot).
export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'payroll')) return new Response('Forbidden', { status: 403 });
  const company = await getActiveCompany();

  const weekParam = req.nextUrl.searchParams.get('week');
  const week =
    weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)
      ? mondayOf(weekParam)
      : mondayOf(new Date().toISOString().slice(0, 10));
  const period = await getOrCreatePeriodForDate(company.id, week);

  const [employees, entries, overrides, snapshots, adjustments, lunch] =
    await Promise.all([
      listEmployees(company.id),
      listTimeEntries(company.id, { payPeriodId: period.id }),
      listPeriodPayOverrides(company.id, { payPeriodId: period.id }),
      listPaystubSnapshots(company.id, { payPeriodId: period.id }),
      listPaystubAdjustments(company.id, { payPeriodId: period.id }),
      listLunchOverrides(company.id, period.id),
    ]);

  const paystubs = computePeriodPaystubs(
    employees,
    entries,
    period,
    overrides,
    snapshots,
    adjustments,
    lunch,
  ).filter((p) => !p.skipped);

  const header = [
    'Employee',
    'Type',
    'Paid hours',
    'Lunch (h)',
    'OT hrs (1.5x)',
    '2x hrs',
    'Rate',
    'Gross',
    'Deductions',
    'NIB (employee)',
    'NIB (employer)',
    'Reimb. / per-diem',
    'Net pay',
  ];

  const body: CsvCell[][] = paystubs.map((p) => [
    p.employeeName,
    p.employmentType,
    Number(p.hoursWorked.toFixed(2)),
    Number(p.lunchHours.toFixed(2)),
    Number(p.overtimeHours.toFixed(2)),
    Number(p.doubleTimeHours.toFixed(2)),
    Number(p.payRate.toFixed(2)),
    Number(p.gross.toFixed(2)),
    Number(p.deductionsTotal.toFixed(2)),
    Number(p.nib.employee.toFixed(2)),
    Number(p.nib.employer.toFixed(2)),
    Number(p.additionsTotal.toFixed(2)),
    Number(p.net.toFixed(2)),
  ]);

  const sum = (pick: (p: (typeof paystubs)[number]) => number) =>
    Number(paystubs.reduce((s, p) => s + pick(p), 0).toFixed(2));

  const totals: CsvCell[] = [
    'TOTAL',
    `${paystubs.length} employee(s)`,
    '', // paid hours
    '', // lunch
    '', // OT hrs
    '', // 2x hrs
    '', // rate
    sum((p) => p.gross),
    sum((p) => p.deductionsTotal),
    sum((p) => p.nib.employee),
    sum((p) => p.nib.employer),
    sum((p) => p.additionsTotal),
    sum((p) => p.net),
  ];

  const rows: CsvCell[][] = [
    [`Payroll register — ${period.startDate} to ${period.endDate}`],
    [`${company.name} · ${period.status === 'locked' ? 'Locked' : 'Open (not yet locked)'}`],
    [],
    header,
    ...body,
    [],
    totals,
  ];

  return csvResponse(
    csvFilename('payroll', period.startDate, period.endDate),
    toCsv(rows),
  );
}
