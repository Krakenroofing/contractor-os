import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildInvoiceSummaryReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildInvoiceSummaryReport(companyId, filters);

  const rows: CsvCell[][] = [
    [
      'Invoice number',
      'Status',
      'Billing type',
      'Invoice date',
      'Due date',
      'Customer',
      'Project',
      'Lines',
      'Subtotal',
      'Tax / VAT',
      'Retainage held',
      'Total',
      'Amount paid',
      'Balance',
    ],
    ...report.rows.map((r) => [
      r.invoiceNumber,
      r.status,
      r.billingType,
      r.invoiceDate,
      r.dueDate ?? '',
      r.customerName,
      r.projectName,
      r.lineCount,
      r.subtotal,
      r.taxAmount,
      r.retainageHeld,
      r.total,
      r.amountPaid,
      r.balance,
    ]),
    [],
    [
      'TOTALS',
      '',
      '',
      '',
      '',
      '',
      '',
      report.rows.reduce((a, r) => a + r.lineCount, 0),
      report.totals.subtotal,
      report.totals.taxAmount,
      report.totals.retainageHeld,
      report.totals.total,
      report.totals.amountPaid,
      report.totals.balance,
    ],
  ];

  return csvResponse(
    csvFilename('invoice-summary', filters.from, filters.to),
    toCsv(rows),
  );
}
