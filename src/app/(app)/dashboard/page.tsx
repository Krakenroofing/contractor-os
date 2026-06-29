import Link from 'next/link';
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
import { isDevDemoMode } from '@/lib/auth';
import { canCreate, canView, ROLE_LABELS } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { buildDashboardData, type AlertItem } from '@/modules/dashboard/lib/dashboard';
import { buildAccountingSummary } from '@/modules/dashboard/lib/accounting-summary';
import { buildRemainingBillable } from '@/modules/dashboard/lib/remaining-billable';
import { listAccountingReviewItems } from '@/lib/data/accounting-review';
import { QuickReportsCard } from '@/modules/reports/components/quick-reports-card';
import { TeamTasksPanel } from '@/modules/team-tasks/components/team-tasks-panel';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const company = await getActiveCompany();
  const role = await getActiveRole();
  const user = await requireAuth();
  const canSeeTeamTasks = canView(role, 'team_tasks');
  const canSeeRemainingBillable = canView(role, 'invoices');
  const [data, accounting, remainingBillable] = await Promise.all([
    buildDashboardData(company.id),
    buildAccountingSummary(company.id),
    canSeeRemainingBillable
      ? buildRemainingBillable(company.id)
      : Promise.resolve(null),
  ]);
  const { kpis, alerts, revenueByQuarter } = data;
  const canSeeBanking = canView(role, 'bank_accounts');
  const canSeeReceipts = canView(role, 'receipts');
  const canSeeStatementImports = canView(role, 'statement_imports');
  // Count of transactions needing a category fix (reviewed-but-uncategorized
  // or split with a missing-category line) — surfaced as an accounting tile.
  const accountingTodoCount = canSeeStatementImports
    ? (await listAccountingReviewItems(company.id)).length
    : 0;
  // Hide VAT chrome for non-VAT companies (e.g. Kraken Roofing LLC, US — no
  // VAT). Only TRB (VAT-registered) should see VAT figures/labels.
  const isVatActive = company.isVatActive;

  // Resource visibility flags — hide sections the active role can't see.
  const canSeeChangeOrders = canView(role, 'change_orders');
  const canSeeInvoices = canView(role, 'invoices');
  const canSeeAR = canView(role, 'accounts_receivable');
  const canSeeRetainage = canView(role, 'retainage');
  const canSeePOs = canView(role, 'purchase_orders');
  const canSeeProposals = canView(role, 'proposals');

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

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
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

      {/* ===== Team notes & tasks (shared admin inbox) ===== */}
      {canSeeTeamTasks && (
        <TeamTasksPanel
          companyId={company.id}
          role={role}
          currentUserId={user.id}
        />
      )}

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
          {remainingBillable && (
            <KPI
              label="Remaining billable (net)"
              value={formatMoney(remainingBillable.totalRemaining)}
              hint={`across ${remainingBillable.rows.length} active job${
                remainingBillable.rows.length === 1 ? '' : 's'
              }`}
              valueClassName="text-blue-700"
            />
          )}
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

      {remainingBillable && remainingBillable.rows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
              Remaining billable by job (net)
            </h2>
            <p className="text-xs text-slate-400 tabular-nums">
              Total: {formatMoney(remainingBillable.totalRemaining)}
            </p>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Revised contract</TableHead>
                    <TableHead className="text-right">Billed (net)</TableHead>
                    <TableHead className="text-right">Remaining billable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remainingBillable.rows.map((r) => (
                    <TableRow key={r.projectId}>
                      <TableCell className="font-medium text-slate-900">
                        <Link
                          href={{ pathname: `/projects/${r.projectId}` }}
                          className="hover:underline"
                        >
                          {r.projectName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {r.customerName ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatMoney(r.revisedContract)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatMoney(r.billedNet)}
                        {r.refundsCredited > 0 && (
                          <span className="ml-1 text-[11px] text-slate-400">
                            (less {formatMoney(r.refundsCredited)} refunded)
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-semibold ${
                          r.remainingBillable > 0
                            ? 'text-blue-700'
                            : r.remainingBillable < 0
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {formatMoney(r.remainingBillable)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-slate-300">
                    <TableCell className="font-semibold text-slate-900">
                      Total
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatMoney(remainingBillable.totalRevisedContract)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatMoney(remainingBillable.totalBilledNet)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-blue-700">
                      {formatMoney(remainingBillable.totalRemaining)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <p className="text-[11px] text-slate-400">
            Active jobs only (in progress / won). Remaining billable = revised
            contract (net) − net billed, with scope-reduction refunds netted
            back. Ties to the still-billable column on the customer summary.
          </p>
        </section>
      )}

      {canSeeInvoices && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
              Revenue by quarter{isVatActive ? ' (ex-VAT)' : ''}
            </h2>
            <p className="text-xs text-slate-400 tabular-nums">
              Total: {formatMoney(kpis.totalInvoicedNet)}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {revenueByQuarter.map((q) => (
              <KPI
                key={q.quarterKey}
                label={q.label}
                value={formatMoney(q.revenueNet)}
                hint={
                  q.invoiceCount === 0
                    ? 'No activity'
                    : `${q.invoiceCount} invoice${q.invoiceCount === 1 ? '' : 's'}${
                        isVatActive ? ` · VAT ${formatMoney(q.vat)}` : ''
                      }`
                }
                valueClassName={
                  q.revenueNet > 0 ? 'text-slate-900' : 'text-slate-400'
                }
                href={isVatActive ? '/reports/vat-quarterly' : '/reports/profit-loss'}
              />
            ))}
          </div>
        </section>
      )}

      {canSeeInvoices && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
            Cash &amp; AR
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {isVatActive && (
              <KPI
                label="VAT invoiced"
                value={formatMoney(kpis.totalInvoicedVAT)}
                hint="On-behalf-of-government — not income"
                valueClassName={kpis.totalInvoicedVAT > 0 ? 'text-amber-700' : undefined}
                href="/reports/vat-quarterly"
              />
            )}
            <KPI
              label="Gross invoiced"
              value={formatMoney(kpis.totalInvoicedGross)}
              hint={`base ${formatMoney(kpis.totalInvoicedGrossBase)} · CO ${formatMoney(
                kpis.totalInvoicedGrossCo,
              )}`}
              href="/invoices"
            />
            <KPI
              label="Total paid (gross)"
              value={formatMoney(kpis.totalPaid)}
              valueClassName="text-emerald-700"
              hint={`base ${formatMoney(kpis.totalPaidGrossBase)} · CO ${formatMoney(
                kpis.totalPaidGrossCo,
              )}`}
              href="/payments"
            />
            <KPI
              label="Outstanding AR"
              value={formatMoney(kpis.outstandingAR)}
              valueClassName={
                kpis.outstandingAR > 0 ? 'text-amber-700' : 'text-emerald-700'
              }
              hint={`base ${formatMoney(kpis.outstandingARBase)} · CO ${formatMoney(
                kpis.outstandingARCo,
              )}`}
              href={canSeeAR ? '/accounts-receivable' : undefined}
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

      {/* ===== Accounting (Banking & Receipts triage) ===== */}
      {(canSeeBanking || canSeeReceipts) && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
            Accounting
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {canSeeStatementImports && (
              <AccountingTile
                label="Accounting to-do"
                value={String(accountingTodoCount)}
                hint={
                  accountingTodoCount > 0
                    ? 'Reviewed-but-uncategorized + incomplete splits'
                    : 'No transactions need attention.'
                }
                tone={accountingTodoCount > 0 ? 'amber' : 'emerald'}
                href="/accounting/todo"
              />
            )}
            {canSeeBanking && (
              <AccountingTile
                label="Uncategorized transactions"
                value={String(accounting.uncategorizedCount)}
                hint={
                  accounting.uncategorizedCount > 0
                    ? `${formatMoney(accounting.uncategorizedTotal)} total (abs)`
                    : 'Nothing waiting — nice.'
                }
                tone={accounting.uncategorizedCount > 0 ? 'amber' : 'slate'}
                href="/banking"
              />
            )}
            {canSeeBanking && (
              <AccountingTile
                label="Unreconciled deposits"
                value={String(accounting.unreconciledDepositsCount)}
                hint={
                  accounting.unreconciledDepositsCount > 0
                    ? `${formatMoney(accounting.unreconciledDepositsTotal)} total`
                    : 'All deposits matched.'
                }
                tone={
                  accounting.unreconciledDepositsCount > 0 ? 'amber' : 'emerald'
                }
                href="/banking"
              />
            )}
            {canSeeReceipts && (
              <AccountingTile
                label="Draft receipts"
                value={String(accounting.unpostedReceiptsCount)}
                hint={
                  accounting.unpostedReceiptsCount > 0
                    ? `${formatMoney(accounting.unpostedReceiptsTotal)} total`
                    : 'No drafts pending Post.'
                }
                tone={accounting.unpostedReceiptsCount > 0 ? 'amber' : 'slate'}
                href="/banking/receipts"
              />
            )}
            {accounting.isVatActive && canView(role, 'reports') && (
              <AccountingTile
                label={`Net VAT due ${accounting.currentQuarterKey.replace(
                  /^(\d{4})-(Q\d)$/,
                  '$2 $1',
                )}`}
                value={formatMoney(accounting.netVatDueThisQuarter)}
                hint={`${formatMoney(
                  accounting.outputVatThisQuarter,
                )} output · ${formatMoney(
                  accounting.inputVatThisQuarter,
                )} input`}
                tone={
                  accounting.netVatDueThisQuarter > 0
                    ? 'amber'
                    : accounting.netVatDueThisQuarter < 0
                      ? 'emerald'
                      : 'slate'
                }
                href="/reports/vat-quarterly"
              />
            )}
            {canView(role, 'reports') && (
              <AccountingTile
                label="COGS this month"
                value={formatMoney(kpis.monthlyCogsTotal)}
                hint={
                  kpis.monthlyCogsCount > 0
                    ? `Across ${kpis.monthlyCogsCount} categor${kpis.monthlyCogsCount === 1 ? 'y' : 'ies'}`
                    : 'No categorized COGS posted yet'
                }
                tone={kpis.monthlyCogsTotal > 0 ? 'amber' : 'slate'}
                href="/reports/profit-loss"
              />
            )}
            {canView(role, 'reports') && (
              <AccountingTile
                label="OpEx this month"
                value={formatMoney(kpis.monthlyOpexTotal)}
                hint={
                  kpis.monthlyOpexCount > 0
                    ? `Across ${kpis.monthlyOpexCount} categor${kpis.monthlyOpexCount === 1 ? 'y' : 'ies'}`
                    : 'No categorized OpEx posted yet'
                }
                tone={kpis.monthlyOpexTotal > 0 ? 'amber' : 'slate'}
                href="/reports/profit-loss"
              />
            )}
          </div>
        </section>
      )}

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

function AccountingTile({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'slate' | 'amber' | 'emerald';
  href: string;
}) {
  const toneClasses: Record<typeof tone, string> = {
    slate: 'text-slate-900',
    amber: 'text-amber-700',
    emerald: 'text-emerald-700',
  };
  const body = (
    <Card className="hover:border-slate-400 transition-colors">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClasses[tone]}`}>
          {value}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  );
  return <Link href={{ pathname: href }}>{body}</Link>;
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
