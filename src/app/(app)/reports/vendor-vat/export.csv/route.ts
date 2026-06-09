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
import { buildVendorVatReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildVendorVatReport(companyId, filters);

  const rows: CsvCell[][] = [
    ['Vendor', 'VAT rate %', 'Transactions', 'Gross paid', 'Material (ex-VAT)', 'VAT paid'],
    ...report.rows.map((r) => [
      r.vendorName,
      r.ratePercent,
      r.transactionCount,
      r.gross,
      r.net,
      r.vat,
    ]),
    [],
    [
      'TOTALS',
      '',
      report.totals.transactionCount,
      report.totals.gross,
      report.totals.net,
      report.totals.vat,
    ],
    [],
    ['Coverage', '', '', '', '', ''],
    ['Total expenses in range', '', '', report.coverage.totalExpenseGross, '', ''],
    ['On VAT vendors', '', '', report.coverage.vatVendorGross, '', ''],
    ['On vendors with no VAT rate', '', '', report.coverage.nonVatVendorGross, '', ''],
    [
      'No vendor set',
      '',
      report.coverage.unassignedCount,
      report.coverage.unassignedGross,
      '',
      '',
    ],
  ];

  return csvResponse(
    csvFilename('vendor-vat', filters.from, filters.to),
    toCsv(rows),
  );
}
