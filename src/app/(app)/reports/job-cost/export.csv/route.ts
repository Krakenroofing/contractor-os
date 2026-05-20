import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildJobCostReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildJobCostReport(companyId, filters);

  const rows: CsvCell[][] = [
    [
      'Project name',
      'Customer',
      'Status',
      'Contract',
      'Approved CO',
      'Revised contract',
      'Estimated cost',
      'Committed',
      'Actual',
      'Landed cost',
      'Landed surcharge',
      'Projected GP',
      'Margin %',
    ],
    ...report.rows.map((r) => [
      r.projectName,
      r.customerName,
      r.projectStatus,
      r.contractValue,
      r.approvedChangeOrders,
      r.revisedContractValue,
      r.estimatedCost,
      r.committedCost,
      r.actualCost,
      r.landedCostTotal,
      r.landedCostSurcharge,
      r.projectedGrossProfit,
      r.projectedGrossMarginPct,
    ]),
    [],
    [
      'TOTALS',
      '',
      '',
      '',
      '',
      report.totals.revisedContractValue,
      report.totals.estimatedCost,
      report.totals.committedCost,
      report.totals.actualCost,
      report.totals.landedCostTotal,
      '',
      report.totals.grossProfit,
      report.weightedMarginPct,
    ],
    [],
    [
      'Cost code breakdown',
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
      '',
      '',
      '',
    ],
    [
      'Project name',
      'Code',
      'Description',
      'Category',
      'Budgeted',
      'Committed',
      'Actual',
      'Variance',
    ],
    ...report.costCodeBreakdown.map((r) => [
      r.projectName,
      r.code,
      r.description,
      r.category,
      r.budgeted,
      r.committed,
      r.actual,
      r.variance,
    ]),
  ];

  return csvResponse(
    csvFilename('job-cost', filters.from, filters.to),
    toCsv(rows),
  );
}
