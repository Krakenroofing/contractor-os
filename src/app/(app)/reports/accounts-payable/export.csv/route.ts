import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import {
  parseApDefaultTermsDays,
  parseReportFilters,
} from '@/modules/reports/lib/filters';
import {
  AGING_BUCKETS,
  BUCKET_LABEL,
  buildAPReport,
} from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const defaultTermsDays = parseApDefaultTermsDays(
    req.nextUrl.searchParams.get('defaultTermsDays') ?? undefined,
  );
  const report = await buildAPReport(companyId, filters, defaultTermsDays);

  const rows: CsvCell[][] = [
    ['AP aging report — by vendor', '', '', '', '', '', '', '', ''],
    [
      `Default terms when vendor missing: ${defaultTermsDays === 0 ? 'Due on receipt' : `Net ${defaultTermsDays}`}`,
      '', '', '', '', '', '', '', '',
    ],
    [],
    [
      'Vendor',
      'Items',
      'Total AP',
      ...AGING_BUCKETS.map((b) => BUCKET_LABEL[b]),
      'Overdue count',
    ],
    ...report.vendorRows.map((v) => [
      v.vendorName,
      v.itemCount,
      v.totalAP,
      v.current,
      v.b1_30,
      v.b31_60,
      v.b61_90,
      v.b90_plus,
      v.overdueCount,
    ]),
    [
      'TOTALS',
      report.summary.itemCount,
      report.summary.totalAP,
      report.summary.current,
      report.summary.b1_30,
      report.summary.b31_60,
      report.summary.b61_90,
      report.summary.b90_plus,
      report.summary.overdueCount,
    ],
    [],
    ['Open commitments', '', '', '', '', '', '', '', ''],
    [
      'Source type',
      'Source ID',
      'Vendor invoice #',
      'Vendor',
      'Project',
      'Issue date',
      'Due date',
      'Terms',
      'Amount',
      'Days overdue',
    ],
    ...report.agingRows.map((r) => [
      r.sourceType === 'po' ? 'PO' : 'Sub payment',
      r.sourceLabel,
      r.vendorInvoiceNumber ?? '',
      r.vendorName,
      r.projectName ?? '',
      r.issueDate,
      r.dueDate,
      r.termsLabel,
      r.amount,
      r.daysOverdue,
    ]),
  ];

  return csvResponse(
    csvFilename('accounts-payable', filters.from, filters.to),
    toCsv(rows),
  );
}
