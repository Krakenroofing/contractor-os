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
import { buildWipReport } from '@/modules/reports/lib/wip';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildWipReport(companyId, filters);

  const rows: CsvCell[][] = [
    [
      `Work in Progress — as of ${report.asOf.toISOString().slice(0, 10)}`,
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
    [],
    [
      'Project',
      'Customer',
      'Status',
      'Contract value',
      'Cost to date',
      '% complete',
      'Revenue earned',
      'Billed to date',
      'Over / (under) billed',
      'Projected GP',
      'Projected GP %',
    ],
    ...report.rows.map((r): CsvCell[] => [
      r.projectName,
      r.customerName,
      r.status,
      r.contractValue,
      r.costToDate,
      `${r.percentComplete.toFixed(1)}%`,
      r.revenueEarned,
      r.billedToDate,
      r.overUnderBilled,
      r.projectedGrossProfit,
      `${r.projectedGrossMarginPct.toFixed(1)}%`,
    ]),
    [
      'TOTALS',
      '',
      '',
      report.summary.contractValue,
      report.summary.costToDate,
      '',
      report.summary.revenueEarned,
      report.summary.billedToDate,
      report.summary.overUnderBilled,
      report.summary.projectedGrossProfit,
      `${report.summary.weightedMarginPct.toFixed(1)}%`,
    ],
  ];

  return csvResponse(
    csvFilename('wip', filters.from, filters.to),
    toCsv(rows),
  );
}
