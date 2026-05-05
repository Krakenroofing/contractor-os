import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isAuthEnabled, isDevDemoMode } from '@/lib/auth';
import { canCreate, canView, ROLE_LABELS } from '@/lib/permissions';
import { formatMoney, formatPercent } from '@/lib/money';
import { buildDashboardData, type AlertItem } from '@/modules/dashboard/lib/dashboard';
import { QuickReportsCard } from '@/modules/reports/components/quick-reports-card';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const company = await getActiveCompany();
  const role = await getActiveRole();
  const data = await buildDashboardData(company.id);
  const { kpis, alerts } = data;

  // Resource visibility flags — hide sections the active role can't see.
  const canSeeChangeOrders = canView(role, 'change_orders');
  const canSeeInvoices = canView(role, 'invoices');
  const canSeeAR = canView(role, 'accounts_receivable');
  const canSeeRetainage = canView(role, 'retainage');
  const canSeePOs = canView(role, 'purchase_orders');
  const canSeeProposals = canView(role, 'proposals');
  const canSeeJobCosting = canView(role, 'job_costing');

  // Quick-link visibility — hide buttons the active role can't act on.
  const quickLinks: { href: string; label: string; resource: Parameters<typeof canCreate>[1] }[] = [
    { href: '/projects/new', label: 'New Project', resource: 'projects' },
    { href: '/estimates/new', label: 'New Estimate', resource: 'estimates' },
    { href: '/proposals/new', label: 'New Proposal', resource: 'proposals' },
    { href: '/invoices/new', label: 'New Invoice', resource: 'invoices' },
    { href: '/purchase-orders/new', label: 'New Purchase Order', resource: 'purchase_orders' },
    {
      href: '/shipping/calculator',
      label: 'New Landed Cost Estimate',
      resource: 'landed_cost',
    },
  ];
  const visibleQuickLinks = quickLinks.filter((l) => canCreate(role, l.resource));

  const totalAlerts =
    alerts.overdueInvoices.count +
    alerts.pendingChangeOrders.count +
    alerts.posNotReceived.count +
    alerts.retainageOverdue.count +
    alerts.proposalsExpiringSoon.count;

  const demoMode = isDevDemoMode();
  const authEnabled = isAuthEnabled();

  // Server-side log — appears in Vercel function logs on each dashboard render.
  // Use this to confirm whether the deployed runtime is actually reading the
  // expected env vars.
  console.log(
    `[contractor-os] dashboard render — NODE_ENV=${process.env.NODE_ENV ?? 'unset'} authEnabled=${authEnabled} demoMode=${demoMode}`,
  );

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      {/* Prominent runtime-mode banner. Shows the same three values as the
          server log on every dashboard render. Remove once production auth
          flow is verified. */}
      <div
        className={`rounded-md border px-4 py-2 text-xs font-mono flex flex-wrap gap-x-4 gap-y-1 ${
          demoMode
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : authEnabled
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
        }`}
      >
        <span>NODE_ENV: <strong>{process.env.NODE_ENV ?? 'unset'}</strong></span>
        <span>authEnabled: <strong>{String(authEnabled)}</strong></span>
        <span>demoMode: <strong>{String(demoMode)}</strong></span>
        <span>
          {demoMode
            ? '← local dev demo'
            : authEnabled
              ? '← real auth, production-ready'
              : '← MISCONFIGURED: no env vars in production'}
        </span>
      </div>

      {demoMode && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — every figure is derived live from the in-memory store for{' '}
          <span className="font-medium">{company.name}</span>. Switch companies in the
          sidebar to re-scope the entire dashboard.
        </div>
      )}

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Owner-level view of {company.name}
            <span className="text-slate-400"> · </span>
            Viewing as {ROLE_LABELS[role]}
            {totalAlerts > 0 && (
              <>
                <span className="text-slate-400"> · </span>
                <span className="text-red-700 font-medium">
                  {totalAlerts} alert{totalAlerts === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
        </div>
        {visibleQuickLinks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {visibleQuickLinks.map((l) => (
              <Link key={l.href} href={{ pathname: l.href }}>
                <Button size="sm" variant="outline">
                  + {l.label.replace(/^New /, '')}
                </Button>
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* ===== Headline KPIs ===== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
          Operations
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KPI
            label="Active projects"
            value={String(kpis.activeProjects)}
            href="/projects"
          />
          <KPI
            label="Total contract value"
            value={formatMoney(kpis.totalContractValue)}
            highlight
          />
          {canSeeChangeOrders && (
            <KPI
              label="Approved change orders"
              value={String(kpis.approvedChangeOrders)}
              hint={formatMoney(kpis.approvedChangeOrderTotal)}
              href="/change-orders"
            />
          )}
          {canSeePOs && (
            <KPI
              label="Committed POs"
              value={String(kpis.committedPurchaseOrders)}
              hint={formatMoney(kpis.committedPurchaseOrderTotal)}
              href="/purchase-orders"
            />
          )}
          {canSeeRetainage && (
            <KPI
              label="Retainage held"
              value={formatMoney(kpis.retainageHeld)}
              valueClassName={
                kpis.retainageHeld > 0 ? 'text-amber-700' : undefined
              }
              href="/retainage"
            />
          )}
        </div>
      </section>

      {canSeeInvoices && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
            Cash &amp; AR
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <KPI
              label="Total invoiced"
              value={formatMoney(kpis.totalInvoiced)}
              href="/invoices"
            />
            <KPI
              label="Total paid"
              value={formatMoney(kpis.totalPaid)}
              valueClassName="text-emerald-700"
              href="/payments"
            />
            <KPI
              label="Outstanding AR"
              value={formatMoney(kpis.outstandingAR)}
              valueClassName={
                kpis.outstandingAR > 0 ? 'text-amber-700' : 'text-emerald-700'
              }
              href={canSeeAR ? '/accounts-receivable' : undefined}
            />
            <KPI
              label="Cash this month"
              value={formatMoney(kpis.cashCollectedThisMonth)}
              valueClassName="text-emerald-700"
              hint="received & applied"
            />
          </div>
        </section>
      )}

      {canSeeJobCosting && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
            Profitability (active projects)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <KPI
              label="Projected gross profit"
              value={formatMoney(kpis.projectedGrossProfit)}
              valueClassName={
                kpis.projectedGrossProfit > 0
                  ? 'text-emerald-700'
                  : kpis.projectedGrossProfit < 0
                    ? 'text-red-600'
                    : undefined
              }
              href="/job-costing"
              highlight
            />
            <KPI
              label="Projected gross margin"
              value={formatPercent(kpis.projectedGrossMarginPct, 2)}
              valueClassName={
                kpis.projectedGrossMarginPct >= 20
                  ? 'text-emerald-700'
                  : kpis.projectedGrossMarginPct >= 10
                    ? 'text-amber-700'
                    : 'text-red-600'
              }
              hint="revised contract vs. estimated cost"
            />
            <KPI
              label="Active projects under track"
              value={String(kpis.activeProjects)}
              hint="contributing to margin %"
            />
          </div>
        </section>
      )}

      {/* ===== Alerts ===== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
          Needs attention
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {canSeeInvoices && (
            <AlertCard
              title="Overdue invoices"
              count={alerts.overdueInvoices.count}
              hint={formatMoney(alerts.overdueInvoices.total)}
              tone="red"
              moreHref={canSeeAR ? '/accounts-receivable' : '/invoices'}
              items={alerts.overdueInvoices.items}
              emptyText="No invoices past due."
            />
          )}
          {canSeeChangeOrders && (
            <AlertCard
              title="Pending change orders"
              count={alerts.pendingChangeOrders.count}
              hint={formatMoney(alerts.pendingChangeOrders.total)}
              tone="amber"
              moreHref="/change-orders"
              items={alerts.pendingChangeOrders.items}
              emptyText="No change orders awaiting decision."
            />
          )}
          {canSeePOs && (
            <AlertCard
              title="POs not yet received"
              count={alerts.posNotReceived.count}
              hint={formatMoney(alerts.posNotReceived.total)}
              tone="amber"
              moreHref="/purchase-orders"
              items={alerts.posNotReceived.items}
              emptyText="All POs received or closed."
            />
          )}
          {canSeeRetainage && (
            <AlertCard
              title="Retainage overdue"
              count={alerts.retainageOverdue.count}
              hint={formatMoney(alerts.retainageOverdue.total)}
              tone="red"
              moreHref="/retainage"
              items={alerts.retainageOverdue.items}
              emptyText="No retainage past expected release."
            />
          )}
          {canSeeProposals && (
            <AlertCard
              title="Proposals expiring soon"
              count={alerts.proposalsExpiringSoon.count}
              hint="next 7 days"
              tone="amber"
              moreHref="/proposals"
              items={alerts.proposalsExpiringSoon.items}
              emptyText="No proposals expiring in the next 7 days."
            />
          )}
        </div>
      </section>

      {/* ===== Quick reports ===== */}
      {canView(role, 'reports') && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
            Quick reports
          </h2>
          <QuickReportsCard />
        </section>
      )}

      {/* ===== Quick links (full list, anchored at bottom) ===== */}
      {visibleQuickLinks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
            Quick actions
          </h2>
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-2">
              {visibleQuickLinks.map((l) => (
                <Link key={l.href} href={{ pathname: l.href }}>
                  <Button size="sm">{l.label}</Button>
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* TEMPORARY runtime-mode debug footer. Remove once production auth flow
          is verified. Visible to all roles so deployment regressions show up
          in user reports. */}
      <footer className="pt-6 border-t border-slate-200 text-[11px] font-mono text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
        <span>NODE_ENV: <span className="text-slate-600">{process.env.NODE_ENV ?? 'unset'}</span></span>
        <span>authEnabled: <span className="text-slate-600">{String(authEnabled)}</span></span>
        <span>demoMode: <span className="text-slate-600">{String(demoMode)}</span></span>
      </footer>
    </div>
  );
}

// ===== Components =====

function KPI({
  label,
  value,
  hint,
  href,
  valueClassName,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  valueClassName?: string;
  highlight?: boolean;
}) {
  const body = (
    <Card
      className={`${highlight ? 'border-slate-300' : ''} ${
        href ? 'hover:border-slate-400 transition-colors' : ''
      }`}
    >
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={{ pathname: href }}>{body}</Link> : body;
}

function AlertCard({
  title,
  count,
  hint,
  tone,
  moreHref,
  items,
  emptyText,
}: {
  title: string;
  count: number;
  hint?: string;
  tone: 'red' | 'amber';
  moreHref: string;
  items: AlertItem[];
  emptyText: string;
}) {
  const isClear = count === 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge tone={isClear ? 'green' : tone}>
            {isClear ? '0' : `${count}${hint ? ` · ${hint}` : ''}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {isClear ? (
          <p className="text-slate-500">{emptyText}</p>
        ) : (
          <>
            <ul className="space-y-1 mb-3">
              {items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={{ pathname: it.href }}
                    className="text-slate-700 hover:underline truncate block"
                    title={it.label}
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
            <Link href={{ pathname: moreHref }}>
              <Button size="sm" variant="outline">
                View all →
              </Button>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
