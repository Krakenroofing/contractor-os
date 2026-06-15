import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
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
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildWipReport } from '@/modules/reports/lib/wip';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function WipReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const params = await searchParams;
  const filters = parseReportFilters(params);

  const [report, projects] = await Promise.all([
    buildWipReport(company.id, filters),
    listProjects(company.id),
  ]);

  const { summary } = report;

  return (
    <ReportShell
      type="wip"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <div className="flex justify-end print:hidden">
        <Link
          href={{ pathname: '/reports/wip/budgets' }}
          className="text-sm text-blue-700 underline underline-offset-2 hover:text-blue-900"
        >
          Set job budgets →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI
          label="Contract value"
          value={formatMoney(summary.contractValue)}
          hint={`${summary.projectCount} project${summary.projectCount === 1 ? '' : 's'}`}
          highlight
        />
        <KPI
          label="Cost to date"
          value={formatMoney(summary.costToDate)}
          hint={
            summary.projectedFinalCost > 0
              ? `of ${formatMoney(summary.projectedFinalCost)} projected final`
              : undefined
          }
          valueClassName="text-amber-700"
        />
        <KPI
          label="Revenue earned"
          value={formatMoney(summary.revenueEarned)}
          hint="cost-basis % complete × contract"
        />
        <KPI
          label="Billed to date"
          value={formatMoney(summary.billedToDate)}
          hint="ex-VAT, non-draft, non-void"
        />
        <KPI
          label={summary.overUnderBilled >= 0 ? 'Under-billed' : 'Over-billed'}
          value={formatMoney(Math.abs(summary.overUnderBilled))}
          hint={
            summary.overUnderBilled >= 0
              ? `${summary.underBilledCount} project${summary.underBilledCount === 1 ? '' : 's'} need to catch up`
              : `${summary.overBilledCount} project${summary.overBilledCount === 1 ? '' : 's'} ahead of work`
          }
          valueClassName={
            summary.overUnderBilled > 0
              ? 'text-amber-700'
              : summary.overUnderBilled < 0
                ? 'text-emerald-700'
                : 'text-slate-900'
          }
        />
        <KPI
          label="Projected GP"
          value={formatMoney(summary.projectedGrossProfit)}
          hint={`${summary.weightedMarginPct.toFixed(1)}% weighted margin`}
          valueClassName={
            summary.projectedGrossProfit >= 0
              ? 'text-emerald-700'
              : 'text-red-600'
          }
          highlight
        />
      </div>

      <p className="text-xs text-slate-500">
        Snapshot as of {report.asOf.toISOString().slice(0, 10)}. Cost-basis %
        complete (cost-to-date / projected-final-cost). Revenue earned caps
        at contract value when costs overrun. Under-billed = work done {'>'} billed
        (catch-up needed). Over-billed = billed ahead of work (healthy for
        cashflow). Projects without a signed contract value are excluded.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>By project</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No projects with a contract value match this filter. Sign a
              contract / record an estimate to start tracking WIP.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Contract</TableHead>
                  <TableHead className="text-right">Cost to date</TableHead>
                  <TableHead className="text-right">% complete</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Over/(Under)</TableHead>
                  <TableHead className="text-right">Projected GP</TableHead>
                  <TableHead className="text-right">GP %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => {
                  const overBilled = r.overUnderBilled < 0;
                  const underBilled = r.overUnderBilled > 0;
                  return (
                    <TableRow key={r.projectId}>
                      <TableCell className="font-medium text-slate-900">
                        <Link
                          href={`/projects/${r.projectId}`}
                          className="text-blue-600 hover:underline"
                        >
                          {r.projectName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 text-sm">
                        {r.customerName}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(r.contractValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.costToDate)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          r.percentComplete > 100
                            ? 'text-red-600 font-medium'
                            : r.percentComplete >= 80
                              ? 'text-amber-700'
                              : 'text-slate-700'
                        }`}
                      >
                        {r.percentComplete.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.revenueEarned)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.billedToDate)}
                        {r.invoiceCount > 0 && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            ({r.invoiceCount})
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          overBilled
                            ? 'text-emerald-700'
                            : underBilled
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {overBilled
                          ? `(${formatMoney(Math.abs(r.overUnderBilled))})`
                          : formatMoney(r.overUnderBilled)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          r.projectedGrossProfit >= 0
                            ? 'text-emerald-700'
                            : 'text-red-600'
                        }`}
                      >
                        {formatMoney(r.projectedGrossProfit)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          r.projectedGrossMarginPct >= 0
                            ? 'text-slate-700'
                            : 'text-red-600'
                        }`}
                      >
                        {r.projectedGrossMarginPct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: 'green' | 'blue' | 'slate' | 'amber' =
    status === 'in_progress'
      ? 'green'
      : status === 'won'
        ? 'blue'
        : status === 'closed' || status === 'archived'
          ? 'slate'
          : 'amber';
  return <Badge tone={tone}>{status.replace('_', ' ')}</Badge>;
}

function KPI({
  label,
  value,
  hint,
  highlight,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <Card className={highlight ? 'border-slate-300' : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName ?? 'text-slate-900'}`}
        >
          {value}
        </p>
        {hint && (
          <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
