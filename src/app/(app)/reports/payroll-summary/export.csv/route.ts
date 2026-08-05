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
import { buildPayrollSummaryReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'payroll')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildPayrollSummaryReport(companyId, filters);
  const t = report.totals;

  const rows: CsvCell[][] = [
    ['Payroll Summary Report', report.companyName, ''],
    ['Window', `${report.windowStart} → ${report.windowEnd}`, `${report.weekCount} weekly period(s)`],
    [],
    ['Totals'],
    ['Employees paid', t.headcount],
    ['Hours worked', t.hoursWorked],
    ['Gross pay', t.gross],
    ['Deductions (pre-NIB)', t.deductionsTotal],
    ['Adjusted gross', t.adjustedGross],
    ['Employee NIB withheld', t.employeeNib],
    ['Employer NIB owed', t.employerNib],
    ['Reimbursements', t.reimbursements],
    ['Per diem', t.perDiem],
    ['Expenses', t.expenses],
    ['Additions total', t.additionsTotal],
    ['Net paid to employees', t.net],
    ['Total labor cost', t.totalLaborCost],
    [],
    ['Per-employee detail'],
    [
      'Employee',
      'Type',
      'NIB exempt',
      'Weeks',
      'Hours',
      'Gross',
      'Deductions',
      'Adjusted gross',
      'Employee NIB',
      'Employer NIB',
      'Reimbursements',
      'Per diem',
      'Expenses',
      'Additions total',
      'Net',
    ],
    ...report.employees.map((e) => [
      e.employeeName,
      e.employmentType,
      e.nibExempt ? 'yes' : 'no',
      e.weekCount,
      e.hoursWorked,
      e.gross,
      e.deductionsTotal,
      e.adjustedGross,
      e.employeeNib,
      e.employerNib,
      e.reimbursements,
      e.perDiem,
      e.expenses,
      e.additionsTotal,
      e.net,
    ]),
    [
      'TOTALS',
      '',
      '',
      '',
      t.hoursWorked,
      t.gross,
      t.deductionsTotal,
      t.adjustedGross,
      t.employeeNib,
      t.employerNib,
      t.reimbursements,
      t.perDiem,
      t.expenses,
      t.additionsTotal,
      t.net,
    ],
    [],
    ['Adjustment line items'],
    [
      'Week ending',
      'Employee',
      'Type',
      'Description',
      'Amount',
    ],
    ...report.adjustments.map((a) => [
      a.payPeriodEnd,
      a.employeeName,
      a.type,
      a.description ?? '',
      a.amount,
    ]),
  ];

  return csvResponse(
    csvFilename('payroll-summary', report.windowStart, report.windowEnd),
    toCsv(rows),
  );
}
