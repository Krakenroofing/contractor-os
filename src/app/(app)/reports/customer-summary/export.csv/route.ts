import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildCustomerSummaryReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildCustomerSummaryReport(companyId, filters);

  const customerName = report.customer?.name ?? '(no customer selected)';

  const rows: CsvCell[][] = [
    [`Customer Summary — ${customerName}`, '', '', '', '', '', '', '', '', '', ''],
    [],
    ['Projects'],
    [
      'Project number',
      'Project name',
      'Status',
      'Base contract',
      'Approved COs',
      'Revised contract',
      'Billed (gross)',
      'Billed (net)',
      'Base billed',
      'CO billed',
      'Still billable',
      'Collected (gross)',
      'Collected (net)',
      'Collected (VAT)',
      'Outstanding AR',
      'Retainage held',
      'Retainage released',
      'Retainage balance',
    ],
    ...report.projectRows.map((r) => [
      r.projectNumber,
      r.projectName,
      r.status,
      r.contractValue,
      r.changeOrders,
      r.revisedContractValue,
      r.totalInvoiced,
      r.totalInvoicedNet,
      r.baseInvoiced,
      r.coInvoiced,
      r.stillBillable,
      r.totalPaid,
      r.totalPaidNet,
      r.totalPaidVat,
      r.outstandingAR,
      r.retainageHeld,
      r.retainageReleased,
      r.retainageBalance,
    ]),
    [
      'TOTALS',
      '',
      '',
      report.totals.contractValue,
      report.totals.changeOrders,
      report.totals.revisedContractValue,
      report.totals.totalInvoiced,
      report.totals.totalInvoicedNet,
      report.totals.baseInvoiced,
      report.totals.coInvoiced,
      report.totals.stillBillable,
      report.totals.totalPaid,
      report.totals.totalPaidNet,
      report.totals.totalPaidVat,
      report.totals.outstandingAR,
      report.totals.retainageHeld,
      report.totals.retainageReleased,
      report.totals.retainageBalance,
    ],
    [],
    ['Invoices'],
    [
      'Invoice',
      'Date',
      'Due',
      'Project number',
      'Project name',
      'Source',
      'CO #',
      'Status',
      'Total (gross)',
      'Net',
      'VAT',
      'Paid',
      'Balance',
    ],
    ...report.invoiceRows.map((r) => [
      r.invoiceNumber,
      r.invoiceDate,
      r.dueDate ?? '',
      r.projectNumber,
      r.projectName,
      r.source === 'co' ? 'CO' : 'Base',
      r.changeOrderNumber ?? '',
      r.status,
      r.total,
      r.subtotal,
      r.taxAmount,
      r.amountPaid,
      r.balance,
    ]),
  ];

  return csvResponse(
    csvFilename('customer-summary', filters.from, filters.to),
    toCsv(rows),
  );
}
