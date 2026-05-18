import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import {
  AGING_BUCKETS,
  BUCKET_LABEL,
  buildARReport,
} from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildARReport(companyId, filters);

  const rows: CsvCell[][] = [
    [
      'AR aging report — by customer',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
    [
      'Customer',
      'Invoices',
      'Total AR',
      'Base AR',
      'CO AR',
      ...AGING_BUCKETS.map((b) => BUCKET_LABEL[b]),
      'Overdue count',
    ],
    ...report.customerRows.map((c) => [
      c.customerName,
      c.invoiceCount,
      c.totalAR,
      c.baseAR,
      c.coAR,
      c.current,
      c.b1_30,
      c.b31_60,
      c.b61_90,
      c.b90_plus,
      c.overdueCount,
    ]),
    [
      'TOTALS',
      report.summary.invoiceCount,
      report.summary.totalAR,
      report.summary.totalARBase,
      report.summary.totalARCo,
      report.summary.current,
      report.summary.b1_30,
      report.summary.b31_60,
      report.summary.b61_90,
      report.summary.b90_plus,
      report.summary.overdueCount,
    ],
    [],
    [
      'Open invoices',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
    [
      'Invoice',
      'Customer',
      'Project',
      'Source',
      'Invoice date',
      'Due date',
      'Total',
      'Paid',
      'Balance',
      'Days overdue',
    ],
    ...report.agingRows.map((r) => [
      r.invoiceNumber,
      r.customerName,
      r.projectName,
      r.changeOrderId ? 'CO' : 'Base',
      r.invoiceDate,
      r.dueDate ?? '',
      r.total,
      r.amountPaid,
      r.balance,
      r.daysOverdue,
    ]),
  ];

  return csvResponse(
    csvFilename('accounts-receivable', filters.from, filters.to),
    toCsv(rows),
  );
}
