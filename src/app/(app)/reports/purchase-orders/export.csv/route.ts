import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildPOSummaryReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildPOSummaryReport(companyId, filters);

  const rows: CsvCell[][] = [
    [
      'PO number',
      'Issue date',
      'Expected delivery',
      'Vendor',
      'Project',
      'Status',
      'Lines',
      'Subtotal',
      'Tax',
      'Shipping',
      'Total',
    ],
    ...report.rows.map((r) => [
      r.poNumber,
      r.issueDate ?? '',
      r.expectedDeliveryDate ?? '',
      r.vendorName,
      r.projectName,
      r.status,
      r.lineCount,
      r.subtotal,
      r.taxAmount,
      r.shipping,
      r.total,
    ]),
    [],
    [
      'TOTALS',
      '',
      '',
      '',
      '',
      '',
      report.rows.reduce((a, r) => a + r.lineCount, 0),
      report.totals.subtotal,
      report.totals.taxAmount,
      report.totals.shipping,
      report.totals.total,
    ],
    [],
    ['By status', 'Count', 'Total', '', '', '', '', '', '', '', ''],
    ...report.byStatus.map((s) => [s.status, s.count, s.total, '', '', '', '', '', '', '', '']),
    ['Open commitments', '', report.totals.open, '', '', '', '', '', '', '', ''],
    ['Closed / received', '', report.totals.closed, '', '', '', '', '', '', '', ''],
  ];

  return csvResponse(
    csvFilename('purchase-orders', filters.from, filters.to),
    toCsv(rows),
  );
}
