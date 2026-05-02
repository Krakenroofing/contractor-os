import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildPaymentSummaryReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildPaymentSummaryReport(companyId, filters);

  const rows: CsvCell[][] = [
    [
      'Payment number',
      'Paid date',
      'Customer',
      'Project',
      'Invoice',
      'Method',
      'Status',
      'Reference',
      'Bank',
      'Amount',
    ],
    ...report.rows.map((r) => [
      r.paymentNumber,
      r.paidDate,
      r.customerName,
      r.projectName,
      r.invoiceNumber,
      r.method ?? '',
      r.status,
      r.reference ?? '',
      r.bankAccount ?? '',
      r.amount,
    ]),
    [],
    ['TOTALS by status', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', 'received', '', '', report.totals.received],
    ['', '', '', '', '', '', 'applied', '', '', report.totals.applied],
    ['', '', '', '', '', '', 'pending', '', '', report.totals.pending],
    ['', '', '', '', '', '', 'returned', '', '', report.totals.returned],
    ['', '', '', '', '', '', 'TOTAL', '', '', report.totals.total],
    [],
    ['By method', 'Count', 'Total', '', '', '', '', '', '', ''],
    ...report.byMethod.map((m) => [m.method, m.count, m.total, '', '', '', '', '', '', '']),
  ];

  return csvResponse(
    csvFilename('payment-summary', filters.from, filters.to),
    toCsv(rows),
  );
}
