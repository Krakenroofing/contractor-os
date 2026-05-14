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
    ['Quarter', 'Invoices', 'Subtotal', 'VAT due', 'Retainage held', 'Total billed'],
    ...report.quarters.map((q) => [
      q.label,
      q.invoiceCount,
      q.subtotal,
      q.vatDue,
      q.retainage,
      q.total,
    ]),
    [
      'TOTALS',
      report.totals.invoiceCount,
      report.totals.subtotal,
      report.totals.vatDue,
      report.totals.retainage,
      report.totals.total,
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
  ];

  return csvResponse(
    csvFilename('vat-quarterly', filters.from, filters.to),
    toCsv(rows),
  );
}
