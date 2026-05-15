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
import { buildVatQuarterlyReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildVatQuarterlyReport(companyId, filters);

  const rows: CsvCell[][] = [
    ['VAT Quarterly Report', report.companyName, ''],
    ['VAT rate', `${report.companyVatRatePct.toFixed(2)}%`, ''],
    [],
    ['Quarter rollup'],
    [
      'Quarter',
      'Invoices',
      'Output VAT',
      'Receipts',
      'Input VAT',
      'Net VAT due',
      'Subtotal billed',
      'Retainage held',
      'Total billed',
      'Subtotal expenses',
      'Total expenses',
    ],
    ...report.quarters.map((q) => [
      q.label,
      q.invoiceCount,
      q.vatDue,
      q.receiptCount,
      q.inputVat,
      q.netVatDue,
      q.subtotal,
      q.retainage,
      q.total,
      q.expenseNet,
      q.expenseGross,
    ]),
    [
      'TOTALS',
      report.totals.invoiceCount,
      report.totals.vatDue,
      report.totals.receiptCount,
      report.totals.inputVat,
      report.totals.netVatDue,
      report.totals.subtotal,
      report.totals.retainage,
      report.totals.total,
      report.totals.expenseNet,
      report.totals.expenseGross,
    ],
    [],
    ['Invoice detail'],
    [
      'Invoice',
      'Customer',
      'Project number',
      'Project name',
      'Invoice date',
      'Quarter',
      'Status',
      'Subtotal',
      'VAT rate %',
      'VAT due',
      'Retainage held',
      'Total',
    ],
    ...report.invoices.map((r) => [
      r.invoiceNumber,
      r.customerName,
      r.projectNumber ?? '',
      r.projectName ?? '',
      r.effectiveDate,
      r.quarterKey.replace(/^(\d{4})-(Q\d)$/, '$2 $1'),
      r.status,
      r.subtotal,
      r.vatRatePct,
      r.vatDue,
      r.retainage,
      r.total,
    ]),
    [],
    ['Expense detail (input VAT)'],
    [
      'Receipt date',
      'Vendor',
      'Project number',
      'Project name',
      'Quarter',
      'Recoverable',
      'Subtotal',
      'VAT rate %',
      'Input VAT',
      'Total',
    ],
    ...report.expenses.map((r) => [
      r.receiptDate,
      r.vendorName,
      r.projectNumber ?? '',
      r.projectName ?? '',
      r.quarterKey.replace(/^(\d{4})-(Q\d)$/, '$2 $1'),
      r.recoverable ? 'yes' : 'no',
      r.subtotal,
      r.vatRatePct,
      r.inputVat,
      r.total,
    ]),
  ];

  return csvResponse(
    csvFilename('vat-quarterly', filters.from, filters.to),
    toCsv(rows),
  );
}
