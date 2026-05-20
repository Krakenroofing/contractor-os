import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  getBackfillKPIs,
  getBackfillWarnings,
  getProjectBackfillStatuses,
} from '@/modules/backfill/lib/backfill';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

export default async function BackfillReviewPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const company = await getActiveCompany();
  const [kpis, warnings, projectStatuses] = await Promise.all([
    getBackfillKPIs(company.id),
    getBackfillWarnings(company.id),
    getProjectBackfillStatuses(company.id),
  ]);

  const incomplete = projectStatuses.filter((p) => !p.complete);
  const warns = warnings.filter((w) => w.severity === 'warn');
  const infos = warnings.filter((w) => w.severity === 'info');

  return (
    <StepShell step="review" prevHref="/backfill/retainage">
      <Card>
        <CardHeader>
          <CardTitle>Financial roll-up — {company.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat
              label="Total contract value"
              value={formatMoney(kpis.totalContractValue)}
              hint={`+ ${formatMoney(kpis.changeOrdersApprovedTotal)} approved COs`}
              highlight
            />
            <Stat label="Total invoiced" value={formatMoney(kpis.totalInvoiced)} />
            <Stat
              label="Total paid"
              value={formatMoney(kpis.totalPaid)}
              valueClassName="text-emerald-700"
            />
            <Stat
              label="Outstanding AR"
              value={formatMoney(kpis.outstandingAR)}
              valueClassName={kpis.outstandingAR > 0 ? 'text-amber-700' : undefined}
            />
            <Stat
              label="Retainage held"
              value={formatMoney(kpis.retainageHeld)}
            />
            <Stat
              label="Retainage released"
              value={formatMoney(kpis.retainageReleased)}
              valueClassName="text-emerald-700"
            />
            <Stat
              label="Retainage outstanding"
              value={formatMoney(kpis.retainageOutstanding)}
              valueClassName={
                kpis.retainageOutstanding > 0 ? 'text-amber-700' : undefined
              }
            />
            <Stat
              label="Open POs"
              value={String(kpis.openPurchaseOrders)}
              hint={formatMoney(kpis.openPurchaseOrderValue)}
              valueClassName={
                kpis.openPurchaseOrders > 0 ? 'text-amber-700' : undefined
              }
            />
          </div>
          {kpis.landedCostTotal > 0 && (
            <p className="text-xs text-slate-500 mt-4">
              Landed-cost imports captured: {formatMoney(kpis.landedCostTotal)}
              <span className="ml-1">
                (added via{' '}
                <Link
                  href={{ pathname: '/shipping/calculator' }}
                  className="underline"
                >
                  shipping calculator
                </Link>
                )
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Data warnings</CardTitle>
              <Badge tone={warns.length > 0 ? 'red' : 'green'}>
                {warns.length} warn / {infos.length} info
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {warnings.length === 0 ? (
              <p className="text-sm text-slate-500">
                No warnings. Backfill looks clean.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {[...warns, ...infos].map((w, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-2 ${
                      w.severity === 'warn' ? 'text-red-700' : 'text-slate-700'
                    }`}
                  >
                    <span
                      className={`mt-1 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        w.severity === 'warn' ? 'bg-red-500' : 'bg-slate-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <p>{w.message}</p>
                      {w.href && (
                        <Link
                          href={{ pathname: w.href }}
                          className="text-xs text-slate-500 hover:underline"
                        >
                          {w.href}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Per-project backfill completion</CardTitle>
              <Badge tone={incomplete.length === 0 ? 'green' : 'amber'}>
                {projectStatuses.length - incomplete.length} / {projectStatuses.length} complete
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {projectStatuses.length === 0 ? (
              <p className="text-sm text-slate-500">No projects yet.</p>
            ) : (
              <ul className="divide-y divide-slate-200 text-sm">
                {projectStatuses.map((p) => (
                  <li
                    key={p.projectId}
                    className="py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {p.projectName}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <Marker label="Estimate" on={p.hasEstimate} />
                        <Marker label="Proposal" on={p.hasProposal} />
                        <Marker label="Invoice" on={p.hasInvoice} />
                        <Marker label="Payment" on={p.hasPayment} />
                      </div>
                    </div>
                    <Link
                      href={{ pathname: `/projects/${p.projectId}` }}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      Open →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 text-sm text-slate-600">
          When you&apos;re happy with the backfill, switch your team to the live
          dashboard at{' '}
          <Link href={{ pathname: '/dashboard' }} className="underline">
            /dashboard
          </Link>
          . The KPIs there derive from the same rows you just entered.
        </CardContent>
      </Card>
    </StepShell>
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

function Marker({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded ${
        on
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-slate-100 text-slate-500'
      }`}
    >
      {on ? '✓' : '·'} {label}
    </span>
  );
}
