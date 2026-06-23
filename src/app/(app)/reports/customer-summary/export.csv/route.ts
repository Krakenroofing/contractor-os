import { NextRequest } from 'next/server';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { taxLabel } from '@/modules/reports/lib/tax-label';
import { buildCustomerSummaryReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const company = await getActiveCompany();
  const tax = taxLabel(company.isVatActive);
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildCustomerSummaryReport(company.id, filters);

  const customerName = report.customer?.name ?? '(no customer selected)';

  const rows: CsvCell[][] = [
    [`Customer Summary — ${customerName}`, '', '', '', '', '', '', '', '', '', ''],
    [],
    ['Projects'],
    [
      'Project name',
      'Status',
      'Base contract',
      'Approved COs',
      'Revised contract',
      'Billed (net)',
      `Billed (${tax})`,
      'Billed (gross)',
      'Base billed',
      'CO billed',
      'Refunds credited (net)',
      'Collected (net)',
      `Collected (${tax})`,
      'Collected (gross)',
      'Still billable',
      'Outstanding AR',
      'Retainage held',
      'Retainage released',
      'Retainage balance',
    ],
    ...report.projectRows.map((r) => [
      r.projectName,
      r.status,
      r.contractValue,
      r.changeOrders,
      r.revisedContractValue,
      r.totalInvoicedNet,
      r.totalInvoicedVat,
      r.totalInvoiced,
      r.baseInvoiced,
      r.coInvoiced,
      r.refundsCredited,
      r.totalPaidNet,
      r.totalPaidVat,
      r.totalPaid,
      r.stillBillable,
      r.outstandingAR,
      r.retainageHeld,
      r.retainageReleased,
      r.retainageBalance,
    ]),
    [
      'TOTALS',
      '',
      report.totals.contractValue,
      report.totals.changeOrders,
      report.totals.revisedContractValue,
      report.totals.totalInvoicedNet,
      report.totals.totalInvoicedVat,
      report.totals.totalInvoiced,
      report.totals.baseInvoiced,
      report.totals.coInvoiced,
      report.totals.refundsCredited,
      report.totals.totalPaidNet,
      report.totals.totalPaidVat,
      report.totals.totalPaid,
      report.totals.stillBillable,
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
      'Project name',
      'Source',
      'CO #',
      'Status',
      'Total (gross)',
      'Net',
      tax,
      'Paid',
      'Balance',
    ],
    ...report.invoiceRows.map((r) => [
      r.invoiceNumber,
      r.invoiceDate,
      r.dueDate ?? '',
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
