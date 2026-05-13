import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { isDevDemoMode } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { listAllProjectFinancials } from '@/modules/job-costing/lib/financials';
import {
  buildAgingRowsForCompany,
  calcCashCollectedThisMonth,
  formatMonthYear,
  summarizeAging,
} from '@/modules/accounts-receivable/lib/ar';
import type { Project } from '@/db/schema';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<
  Project['status'],
  'slate' | 'blue' | 'amber' | 'green' | 'red'
> = {
  lead: 'slate',
  estimating: 'blue',
  won: 'green',
  in_progress: 'amber',
  closed: 'green',
  lost: 'red',
};

const STATUS_LABEL: Record<Project['status'], string> = {
  lead: 'Lead',
  estimating: 'Estimating',
  won: 'Won',
  in_progress: 'In Progress',
  closed: 'Closed',
  lost: 'Lost',
};

export default async function JobCostingPage() {
  const companyId = await getActiveCompanyId();
  const rows = await listAllProjectFinancials(companyId);
  const asOf = new Date();
  const arRows = await buildAgingRowsForCompany(companyId, asOf);
  const arSummary = summarizeAging(arRows);
  const cashThisMonth = await calcCashCollectedThisMonth(companyId, asOf);
  const monthLabel = formatMonthYear(asOf);

  const totalRevised = rows.reduce((a, r) => a + r.revisedContractValue, 0);
  const totalEstCost = rows.reduce((a, r) => a + r.estimatedCost, 0);
  const totalCommitted = rows.reduce((a, r) => a + r.committedCost, 0);
  const totalActual = rows.reduce((a, r) => a + r.actualCost, 0);
  const totalCTC = rows.reduce((a, r) => a + r.costToComplete, 0);
  const totalProjectedFinal = rows.reduce((a, r) => a + r.projectedFinalCost, 0);
  const totalLanded = rows.reduce((a, r) => a + r.landedCostTotal, 0);
  const totalGP = rows.reduce((a, r) => a + r.projectedGrossProfit, 0);
  const portfolioMargin =
    totalRevised > 0 ? (totalGP / totalRevised) * 100 : 0;

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — job costing rolls up live from estimates, approved change orders,
          purchase orders (committed + received), and labor entries.
        </div>
      )}

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Job Costing</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {rows.length} {rows.length === 1 ? 'project' : 'projects'} · portfolio view
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KPI label="Revised contract" value={formatMoney(totalRevised)} />
        <KPI label="Estimated cost" value={formatMoney(totalEstCost)} />
        <KPI label="Committed" value={formatMoney(totalCommitted)} />
        <KPI label="Actual" value={formatMoney(totalActual)} />
        <KPI
          label="Cost to complete"
          value={formatMoney(totalCTC)}
          sub={totalCTC > 0 ? 'Across forecasted codes' : 'No forecasts yet'}
          valueClassName={totalCTC > 0 ? 'text-slate-900' : 'text-slate-400'}
        />
        <KPI label="Landed cost" value={formatMoney(totalLanded)} sub="all-in delivered" />
        <KPI
          label="Projected GP"
          value={formatMoney(totalGP)}
          sub={`${portfolioMargin.toFixed(1)}% margin · final ${formatMoney(totalProjectedFinal)}`}
          valueClassName={
            totalGP < 0 ? 'text-red-600' : totalGP > 0 ? 'text-emerald-700' : 'text-slate-900'
          }
        />
      </div>

      {/* AR snapshot — links to /accounts-receivable */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-4 mb-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Accounts receivable snapshot
          </p>
          <Link
            href="/accounts-receivable"
            className="text-xs text-slate-600 hover:underline"
          >
            View AR aging →
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ARStat
            label="Total outstanding AR"
            value={formatMoney(arSummary.totalAR)}
            sub={`${arSummary.invoiceCount} open ${
              arSummary.invoiceCount === 1 ? 'invoice' : 'invoices'
            }`}
          />
          <ARStat
            label="Overdue invoices"
            value={String(arSummary.overdueCount)}
            sub={
              arSummary.overdueCount === 0
                ? 'all current'
                : `${formatMoney(
                    arSummary.b1_30 + arSummary.b31_60 + arSummary.b61_90 + arSummary.b90_plus,
                  )} past due`
            }
            valueClassName={arSummary.overdueCount > 0 ? 'text-red-600' : undefined}
          />
          <ARStat
            label={`Cash collected (${monthLabel})`}
            value={formatMoney(cashThisMonth)}
            valueClassName="text-emerald-700"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No projects to cost yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Contract</TableHead>
                <TableHead className="text-right">Approved CO</TableHead>
                <TableHead className="text-right">Revised</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">CTC</TableHead>
                <TableHead className="text-right">Proj. final</TableHead>
                <TableHead className="text-right">Landed</TableHead>
                <TableHead className="text-right">Proj. GP</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.projectId}>
                  <TableCell className="font-medium text-slate-900">
                    <span className="font-mono text-xs text-slate-500 mr-2">
                      {r.projectNumber}
                    </span>
                    {r.projectName}
                  </TableCell>
                  <TableCell className="text-slate-600">{r.customerName}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.contractValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.approvedChangeOrders)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(r.revisedContractValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.estimatedCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.committedCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.actualCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {r.costToComplete > 0 ? formatMoney(r.costToComplete) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.projectedFinalCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {r.landedCostTotal > 0 ? formatMoney(r.landedCostTotal) : '—'}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      r.projectedGrossProfit < 0
                        ? 'text-red-600'
                        : r.projectedGrossProfit > 0
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                    }`}
                  >
                    {formatMoney(r.projectedGrossProfit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {r.revisedContractValue > 0
                      ? `${r.projectedGrossMarginPct.toFixed(1)}%`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/job-costing/${r.projectId}`}>
                      <Button size="sm" variant="outline">
                        View Job Cost
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ARStat({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          valueClassName ?? 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-slate-500 tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}
