import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import {
  csvFilename,
  csvResponse,
  toCsv,
  type CsvCell,
} from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildNibMonthlyReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'payroll')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildNibMonthlyReport(companyId, filters);

  const rows: CsvCell[][] = [
    ['NIB Monthly Report (C-10)', report.companyName, report.monthLabel],
    [
      'Window',
      `${report.monthStart} → ${report.monthEnd}`,
      `${report.totals.weeksInMonth} weekly period(s)`,
    ],
    [],
    ['Monthly totals'],
    ['Employees on payroll', report.totals.headcount],
    ['Total gross wages (post-deduction)', report.totals.totalGross],
    ['Total insurable wages', report.totals.totalInsurableWage],
    ['Employee NIB withheld', report.totals.totalEmployee],
    ['Employer NIB owed', report.totals.totalEmployer],
    ['Total NIB remittance', report.totals.totalRemittance],
    [],
    ['Per-employee detail'],
    [
      'Employee',
      'Type',
      'Weeks',
      'Gross',
      'Insurable wage',
      'Employee NIB',
      'Employer NIB',
      'Net',
    ],
    ...report.employees.map((e) => [
      e.employeeName,
      e.employmentType,
      e.weekCount,
      e.adjustedGross,
      e.insurableWage,
      e.employeeNib,
      e.employerNib,
      e.net,
    ]),
    [
      'TOTALS',
      '',
      '',
      report.totals.totalGross,
      report.totals.totalInsurableWage,
      report.totals.totalEmployee,
      report.totals.totalEmployer,
      report.totals.totalGross - report.totals.totalEmployee,
    ],
    [],
    ['Weekly breakdown'],
    [
      'Week start',
      'Week end',
      'Status',
      'Headcount',
      'Gross',
      'Insurable wage',
      'Employee NIB',
      'Employer NIB',
      'Remittance',
    ],
    ...report.weeks.map((w) => [
      w.startDate,
      w.endDate,
      w.status,
      w.headcount,
      w.totalGross,
      w.totalInsurableWage,
      w.totalEmployee,
      w.totalEmployer,
      w.totalRemittance,
    ]),
  ];

  return csvResponse(
    csvFilename(
      `nib-monthly-${report.monthKey}`,
      report.monthStart,
      report.monthEnd,
    ),
    toCsv(rows),
  );
}
