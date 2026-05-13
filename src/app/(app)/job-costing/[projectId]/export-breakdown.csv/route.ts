import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/data/projects';
import { computeProjectCostCodeBreakdown } from '@/modules/job-costing/lib/financials';
import {
  csvResponse,
  toCsv,
  type CsvCell,
} from '@/modules/reports/lib/csv';

export const dynamic = 'force-dynamic';

// GET /job-costing/<projectId>/export-breakdown.csv
//
// One row per cost code with Budgeted / Committed / Actual / CTC /
// Projected Final / Variance / Variance %. Matches the Cost code breakdown
// table on the job-costing project page.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'job_costing')) {
    return new Response('Forbidden', { status: 403 });
  }
  const { projectId } = await params;
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return new Response('Not found', { status: 404 });

  const breakdown = await computeProjectCostCodeBreakdown(companyId, projectId);

  const headers: CsvCell[] = [
    'Cost code',
    'Description',
    'Category',
    'Budgeted',
    'Committed',
    'Actual',
    'Cost to complete',
    'Projected final',
    'Variance',
    'Variance %',
  ];
  // Totals row at the bottom for quick spot-checks.
  const totals = breakdown.reduce(
    (acc, r) => ({
      budgeted: acc.budgeted + r.budgeted,
      committed: acc.committed + r.committed,
      actual: acc.actual + r.actual,
      ctc: acc.ctc + r.costToComplete,
      projectedFinal: acc.projectedFinal + r.projectedFinal,
      variance: acc.variance + r.variance,
    }),
    { budgeted: 0, committed: 0, actual: 0, ctc: 0, projectedFinal: 0, variance: 0 },
  );
  const totalsVariancePct =
    totals.budgeted > 0 ? (totals.variance / totals.budgeted) * 100 : 0;

  const rows: CsvCell[][] = [
    headers,
    ...breakdown.map((r) => [
      r.code,
      r.description,
      r.category,
      r.budgeted,
      r.committed,
      r.actual,
      r.costToComplete,
      r.projectedFinal,
      r.budgeted > 0 ? r.variance : '',
      r.budgeted > 0 ? r.variancePct.toFixed(1) : '',
    ]),
    [],
    [
      'TOTALS',
      '',
      '',
      totals.budgeted,
      totals.committed,
      totals.actual,
      totals.ctc,
      totals.projectedFinal,
      totals.budgeted > 0 ? totals.variance : '',
      totals.budgeted > 0 ? totalsVariancePct.toFixed(1) : '',
    ],
  ];

  const filename = `job-cost-breakdown-${project.number}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  return csvResponse(filename, toCsv(rows));
}
