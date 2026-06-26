import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney, formatPercent } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildJobCostReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function JobCostReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildJobCostReport(company.id, filters),
    listProjects(company.id),
  ]);

  return (
    <ReportShell
      type="job-cost"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI label="Revised contract" value={formatMoney(report.totals.revisedContractValue)} highlight />
        <KPI label="Estimated cost" value={formatMoney(report.totals.estimatedCost)} />
        <KPI label="Committed" value={formatMoney(report.totals.committedCost)} />
        <KPI label="Actual" value={formatMoney(report.totals.actualCost)} />
        <KPI label="Landed cost" value={formatMoney(report.totals.landedCostTotal)} />
        <KPI
          label="Gross profit"
          value={formatMoney(report.totals.grossProfit)}
          valueClassName={report.totals.grossProfit < 0 ? 'text-red-600' : 'text-emerald-700'}
        />
      </div>

      <p className="text-sm text-slate-600">
        Portfolio margin: <span className="font-semibold tabular-nums">{formatPercent(report.weightedMarginPct, 2)}</span>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Project rollup</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Revised</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Landed</TableHead>
                <TableHead className="text-right">GP</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.projectId}>
                  <TableCell className="font-medium text-slate-900">
                    <Link
                      href={{ pathname: `/projects/${r.projectId}` }}
                      className="text-blue-700 hover:underline"
                    >
                      {r.projectName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{r.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(r.revisedContractValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.estimatedCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.committedCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.actualCost)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.landedCostTotal)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.projectedGrossProfit < 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {formatMoney(r.projectedGrossProfit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(r.projectedGrossMarginPct, 2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {report.costCodeBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cost code breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Budgeted</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.costCodeBreakdown.map((r, i) => (
                  <TableRow key={`${r.projectId}-${r.costCodeId}-${i}`}>
                    <TableCell className="text-xs text-slate-700">
                      <Link
                        href={{ pathname: `/projects/${r.projectId}` }}
                        className="text-blue-700 hover:underline"
                      >
                        {r.projectName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-slate-700">{r.description}</TableCell>
                    <TableCell className="text-slate-500">{r.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.budgeted)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.committed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.actual)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        r.variance < 0 ? 'text-red-600' : 'text-slate-600'
                      }`}
                    >
                      {formatMoney(r.variance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </ReportShell>
  );
}

function KPI({
  label,
  value,
  highlight,
  valueClassName,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <Card className={highlight ? 'border-slate-300' : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName ?? 'text-slate-900'}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
