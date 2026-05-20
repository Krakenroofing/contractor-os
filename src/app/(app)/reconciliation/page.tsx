import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { canView, ROLE_LABELS } from '@/lib/permissions';
import { formatMoney, subtract } from '@/lib/money';
import { buildReconciliationData } from '@/modules/reconciliation/lib/reconciliation';

export const dynamic = 'force-dynamic';

const SEVERITY_TONE = {
  error: 'red',
  warn: 'amber',
  info: 'slate',
} as const;

const CATEGORY_LABEL: Record<string, string> = {
  'invoice-mismatch': 'Invoice mismatch',
  'payment-mismatch': 'Payment mismatch',
  'orphaned-invoice': 'Orphaned invoice',
  'orphaned-payment': 'Orphaned payment',
  'negative-balance': 'Negative balance',
  'co-not-rolled-up': 'CO not rolled up',
  'orphaned-po': 'Orphaned PO',
  'orphaned-landed-cost': 'Orphaned landed cost',
  'retainage-mismatch': 'Retainage mismatch',
};

export default async function ReconciliationPage() {
  const role = await getActiveRole();
  if (!canView(role, 'reconciliation')) redirect('/dashboard');
  const company = await getActiveCompany();
  const data = await buildReconciliationData(company.id);

  const arDelta = subtract(data.expectedAR, data.observedAR);
  const committedDelta = subtract(
    data.expectedCommittedCost,
    data.observedCommittedCost,
  );

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Reconciliation — every figure here is derived live from the same data
        layer the rest of the app reads. Mark each project verified once you
        have cross-checked the numbers against your real-world records.
      </div>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Reconciliation &amp; Data Validation
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data.rows.length} project{data.rows.length === 1 ? '' : 's'} for{' '}
            {company.name} · viewing as {ROLE_LABELS[role]}
          </p>
        </div>
        <Link href={{ pathname: '/dashboard' }}>
          <Button size="sm" variant="outline">
            ← Back to dashboard
          </Button>
        </Link>
      </header>

      {/* ===== Summary cards ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Total discrepancies"
          value={String(data.totalDiscrepancies)}
          hint={`${data.warnings.filter((w) => w.severity === 'error').length} error / ${data.warnings.filter((w) => w.severity === 'warn').length} warn / ${data.warnings.filter((w) => w.severity === 'info').length} info`}
          tone={data.totalDiscrepancies > 0 ? 'red' : 'green'}
        />
        <SummaryCard
          label="Total AR vs expected"
          value={formatMoney(data.observedAR)}
          hint={
            Math.abs(arDelta) < 0.005
              ? 'matches'
              : `Δ ${formatMoney(arDelta)} vs ${formatMoney(data.expectedAR)}`
          }
          tone={Math.abs(arDelta) < 0.005 ? 'green' : 'amber'}
        />
        <SummaryCard
          label="Committed vs expected"
          value={formatMoney(data.observedCommittedCost)}
          hint={
            Math.abs(committedDelta) < 0.005
              ? 'matches'
              : `Δ ${formatMoney(committedDelta)} vs ${formatMoney(data.expectedCommittedCost)}`
          }
          tone={Math.abs(committedDelta) < 0.005 ? 'green' : 'amber'}
        />
        <SummaryCard
          label="Verified projects"
          value={`${data.verifiedProjects} / ${data.verifiedProjects + data.unverifiedProjects}`}
          hint={
            data.unverifiedProjects === 0
              ? 'all verified'
              : `${data.unverifiedProjects} pending`
          }
          tone={data.unverifiedProjects === 0 ? 'green' : 'slate'}
        />
      </div>

      {/* ===== Warnings panel ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Warnings panel</CardTitle>
            <Badge
              tone={
                data.warnings.length === 0
                  ? 'green'
                  : data.warnings.some((w) => w.severity === 'error')
                    ? 'red'
                    : 'amber'
              }
            >
              {data.warnings.length === 0
                ? 'Clean'
                : `${data.warnings.length} flagged`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {data.warnings.length === 0 ? (
            <p className="text-sm text-slate-500">
              No inconsistencies detected. All cross-table totals reconcile within
              ½-cent rounding tolerance.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 text-sm">
              {data.warnings.map((w, i) => (
                <li
                  key={i}
                  className="py-2 flex items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Badge tone={SEVERITY_TONE[w.severity]}>
                      {w.severity}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-slate-800">{w.message}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {CATEGORY_LABEL[w.category] ?? w.category}
                      </p>
                    </div>
                  </div>
                  {w.href && (
                    <Link
                      href={{ pathname: w.href }}
                      className="text-xs text-slate-600 hover:underline whitespace-nowrap"
                    >
                      Open record →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ===== Project table ===== */}
      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No projects to reconcile.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Revised contract</TableHead>
                <TableHead className="text-right">Invoiced</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding AR</TableHead>
                <TableHead className="text-right">Retainage held</TableHead>
                <TableHead className="text-right">PO commitments</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead className="text-right">Actual cost</TableHead>
                <TableHead className="text-right">Proj. GP</TableHead>
                <TableHead className="text-right">Warnings</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.projectId}>
                  <TableCell className="font-medium text-slate-900">
                    {r.projectName}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.customerName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(r.revisedContractValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.totalInvoiced)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">
                    {formatMoney(r.totalPaid)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.outstandingAR > 0 ? 'text-amber-700' : 'text-slate-600'
                    }`}
                  >
                    {formatMoney(r.outstandingAR)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.retainageBalance)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.poCommitments)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.estimatedCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {formatMoney(r.actualCost)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.projectedGrossProfit < 0
                        ? 'text-red-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {formatMoney(r.projectedGrossProfit)}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.warningsCount === 0 ? (
                      <Badge tone="green">0</Badge>
                    ) : (
                      <Badge
                        tone={
                          r.warningsBySeverity.error > 0 ? 'red' : 'amber'
                        }
                      >
                        {r.warningsCount}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.verifiedAt ? (
                      <Badge tone="green">Verified</Badge>
                    ) : (
                      <Badge tone="slate">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={{ pathname: `/reconciliation/${r.projectId}` }}
                    >
                      <Button size="sm" variant="outline">
                        Open
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

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: 'green' | 'amber' | 'red' | 'slate';
}) {
  const valueClass =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-600'
          : 'text-slate-900';
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}
