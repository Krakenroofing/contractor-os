import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney, formatPercent } from '@/lib/money';
import { buildReconciliationData } from '@/modules/reconciliation/lib/reconciliation';
import { VerifyButton } from '@/modules/reconciliation/components/verify-button';

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

export default async function ReconciliationDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reconciliation')) redirect('/dashboard');
  const allowed = canCreate(role, 'reconciliation');
  const { projectId } = await params;
  const companyId = await getActiveCompanyId();

  const data = await buildReconciliationData(companyId);
  const row = data.rows.find((r) => r.projectId === projectId);
  if (!row) notFound();

  const projectWarnings = data.warnings.filter(
    (w) => w.projectId === projectId,
  );

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumbs
        items={[
          { href: '/reconciliation', label: 'Reconciliation' },
          { label: row.projectName },
        ]}
      />

      <div className="flex items-center justify-between">
        <Link href={{ pathname: '/reconciliation' }}>
          <Button variant="outline" size="sm">
            ← All projects
          </Button>
        </Link>
        <Link href={{ pathname: `/projects/${row.projectId}` }}>
          <Button variant="ghost" size="sm">
            View project →
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {row.projectName}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">{row.customerName}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
            Verification
          </p>
          <VerifyButton
            projectId={row.projectId}
            verifiedAt={row.verifiedAt}
            verifiedRole={row.verifiedRole}
            verifiedNote={row.verifiedNote}
            allowed={allowed}
          />
        </div>
      </div>

      {/* ===== Contract roll-up ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Contract roll-up</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <Stat
              label="Original contract"
              value={formatMoney(row.originalContractValue)}
            />
            <Stat
              label="Approved change orders"
              value={formatMoney(row.approvedChangeOrders)}
            />
            <Stat
              label="Revised contract"
              value={formatMoney(row.revisedContractValue)}
              highlight
            />
          </div>
        </CardContent>
      </Card>

      {/* ===== Billing roll-up ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Billing &amp; AR</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat
              label="Invoices"
              value={String(row.invoiceCount)}
              hint="rows on this project"
            />
            <Stat label="Total invoiced" value={formatMoney(row.totalInvoiced)} />
            <Stat
              label="Total paid"
              value={formatMoney(row.totalPaid)}
              valueClassName="text-emerald-700"
            />
            <Stat
              label="Outstanding AR"
              value={formatMoney(row.outstandingAR)}
              valueClassName={
                row.outstandingAR > 0 ? 'text-amber-700' : 'text-slate-900'
              }
              highlight
            />
          </div>
        </CardContent>
      </Card>

      {/* ===== Retainage ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Retainage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <Stat label="Held" value={formatMoney(row.retainageHeld)} />
            <Stat
              label="Released"
              value={formatMoney(row.retainageReleased)}
              valueClassName="text-emerald-700"
            />
            <Stat
              label="Outstanding"
              value={formatMoney(row.retainageBalance)}
              valueClassName={
                row.retainageBalance > 0 ? 'text-amber-700' : 'text-emerald-700'
              }
              highlight
            />
          </div>
        </CardContent>
      </Card>

      {/* ===== Cost roll-up ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Cost roll-up</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat
              label="PO commitments"
              value={formatMoney(row.poCommitments)}
              hint="open POs only"
            />
            <Stat label="Estimated cost" value={formatMoney(row.estimatedCost)} />
            <Stat
              label="Actual cost (POs + landed cost)"
              value={formatMoney(row.actualCost)}
            />
            <Stat
              label="Landed cost (all-in)"
              value={formatMoney(row.landedCostTotal)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ===== Profit ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Profitability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <Stat
              label="Projected gross profit"
              value={formatMoney(row.projectedGrossProfit)}
              valueClassName={
                row.projectedGrossProfit < 0
                  ? 'text-red-600'
                  : row.projectedGrossProfit > 0
                    ? 'text-emerald-700'
                    : 'text-slate-900'
              }
              highlight
            />
            <Stat
              label="Projected margin %"
              value={formatPercent(row.projectedGrossMarginPct, 2)}
              valueClassName={
                row.projectedGrossMarginPct >= 20
                  ? 'text-emerald-700'
                  : row.projectedGrossMarginPct >= 10
                    ? 'text-amber-700'
                    : 'text-red-600'
              }
            />
            <Stat
              label="Revenue used"
              value={formatMoney(row.revisedContractValue)}
              hint="revised contract"
            />
          </div>
        </CardContent>
      </Card>

      {/* ===== Warnings for this project ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Validation warnings</CardTitle>
            <Badge tone={projectWarnings.length === 0 ? 'green' : 'amber'}>
              {projectWarnings.length === 0
                ? 'Clean'
                : `${projectWarnings.length} flagged`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {projectWarnings.length === 0 ? (
            <p className="text-sm text-slate-500">
              No warnings tagged to this project. Cross-table totals reconcile.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 text-sm">
              {projectWarnings.map((w, i) => (
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

      {row.verifiedAt && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
          ✓ This project has been marked reconciled. Use the &ldquo;Un-verify&rdquo;
          button at the top of the page to clear the flag if numbers change.
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  valueClassName,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-0.5 ${highlight ? 'text-lg font-semibold' : 'text-base font-medium'} tabular-nums ${
          valueClassName ?? 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
