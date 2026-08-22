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
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import {
  buildProfitLossReport,
  getProfitLossActivityRange,
} from '@/lib/data/profit-loss';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { exTaxLabel } from '@/modules/reports/lib/tax-label';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function ProfitLossReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const params = await searchParams;
  const rawFilters = parseReportFilters(params);

  // When the user hasn't picked a range, fill the inputs (and the header
  // subtitle) with the range actually shown — earliest activity → today —
  // instead of leaving them blank. The data is identical (this span covers
  // everything), it's just no longer ambiguous.
  let filters = rawFilters;
  if (!rawFilters.from || !rawFilters.to) {
    const range = await getProfitLossActivityRange(company.id);
    filters = {
      ...rawFilters,
      from: rawFilters.from || range.from || '',
      to: rawFilters.to || range.to,
    };
  }

  const [report, projects, allAccounts] = await Promise.all([
    buildProfitLossReport(company.id, filters),
    listProjects(company.id),
    listAccountingAccounts(company.id),
  ]);

  // Subaccount rollup: child accountId → parent CATEGORY id (only when the
  // parent is itself a leaf category, not a section header). Lets COGS/OpEx
  // render QB-style: parent, indented subaccounts, bold "Total parent" row.
  const acctById = new Map(allAccounts.map((a) => [a.id, a]));
  const parentCategoryOf = new Map<string, string>();
  for (const a of allAccounts) {
    if (!a.parentId) continue;
    const parent = acctById.get(a.parentId);
    if (parent && parent.parentId !== null) {
      parentCategoryOf.set(a.id, parent.id);
    }
  }
  const accountNameOf = (id: string) => acctById.get(id)?.name ?? '—';

  const netSign = report.netIncome >= 0;
  const grossSign = report.grossProfit >= 0;
  const exTax = exTaxLabel(company.isVatActive);

  // Revenue drill-down links carry the statement's date filter so the invoice
  // list ties to the income number on the report.
  const revQs = new URLSearchParams();
  if (filters.from) revQs.set('from', filters.from);
  if (filters.to) revQs.set('to', filters.to);
  const revenueHref = (account?: string) => {
    const qs = new URLSearchParams(revQs);
    if (account) qs.set('account', account);
    const s = qs.toString();
    return `/reports/profit-loss/revenue${s ? `?${s}` : ''}`;
  };
  // COGS / OpEx section totals drill into the expense report (every
  // underlying line, same date window).
  const expensesHref = `/reports/expenses${revQs.toString() ? `?${revQs.toString()}` : ''}`;

  return (
    <ReportShell
      type="profit-loss"
      filters={filters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPI
          label="Revenue"
          value={formatMoney(report.income.total)}
          hint={`${report.income.invoiceCount} invoice${report.income.invoiceCount === 1 ? '' : 's'} (${exTax})`}
          highlight
          href={report.income.total > 0 ? revenueHref() : undefined}
        />
        <KPI
          label="COGS"
          value={formatMoney(report.cogs.total)}
          hint={`${report.cogs.accounts.length} categor${report.cogs.accounts.length === 1 ? 'y' : 'ies'}`}
          valueClassName="text-amber-700"
          href="#cogs"
        />
        <KPI
          label="Gross profit"
          value={formatMoney(report.grossProfit)}
          hint={`${report.grossMarginPercent.toFixed(1)}% margin`}
          valueClassName={
            grossSign ? 'text-emerald-700' : 'text-red-600'
          }
          href="#bottom-line"
        />
        <KPI
          label="Operating expense"
          value={formatMoney(report.opex.total)}
          hint={`${report.opex.accounts.length} categor${report.opex.accounts.length === 1 ? 'y' : 'ies'}`}
          valueClassName="text-amber-700"
          href="#opex"
        />
        <KPI
          label="Net income"
          value={formatMoney(report.netIncome)}
          valueClassName={
            netSign ? 'text-emerald-700' : 'text-red-600'
          }
          highlight
          href="#bottom-line"
        />
      </div>

      {report.uncategorized.total > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">
            {formatMoney(report.uncategorized.total)}
          </span>{' '}
          of cost ({report.uncategorized.entryCount} entr
          {report.uncategorized.entryCount === 1 ? 'y' : 'ies'}) is uncategorized
          and excluded from COGS / OpEx above. These are job-cost rows posted
          before the operational category was set on the source receipt. Open
          those receipts, pick a category, and re-post to fix.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              Income —{' '}
              <Link
                href={revenueHref() as never}
                className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
              >
                {formatMoney(report.income.total)}
              </Link>
            </CardTitle>
            <Link
              href={'/invoices/categorize-revenue' as never}
              className="text-sm text-blue-700 underline underline-offset-2 hover:text-blue-900 print:hidden"
            >
              Categorize revenue →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {report.income.total === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No invoices in this date range (excluding draft + void).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Revenue category</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Amount ({exTax})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.income.accounts.map((a) => (
                  <TableRow key={a.accountId}>
                    <TableCell>
                      <Link
                        href={revenueHref(a.accountId) as never}
                        className="text-slate-900 underline-offset-2 hover:underline"
                      >
                        {a.accountName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {a.entryCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <Link
                        href={revenueHref(a.accountId) as never}
                        className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                      >
                        {formatMoney(a.amount)}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {report.income.uncategorized.total > 0 && (
                  <TableRow>
                    <TableCell>
                      <Link
                        href={revenueHref('uncategorized') as never}
                        className="text-amber-800 underline-offset-2 hover:underline"
                      >
                        Uncategorized revenue
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {report.income.uncategorized.invoiceCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <Link
                        href={revenueHref('uncategorized') as never}
                        className="text-amber-800 underline underline-offset-2 hover:text-amber-900"
                      >
                        {formatMoney(report.income.uncategorized.total)}
                      </Link>
                    </TableCell>
                  </TableRow>
                )}
                {report.income.creditMemos.total > 0 && (
                  <TableRow>
                    <TableCell className="text-slate-700">
                      <Link
                        href={revenueHref() as never}
                        className="underline-offset-2 hover:underline"
                      >
                        Less credit memos
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">
                        job credits / backcharges / refunds — contra-revenue
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {report.income.creditMemos.count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <Link
                        href={revenueHref() as never}
                        className="text-red-700 underline underline-offset-2 hover:text-red-900"
                      >
                        ({formatMoney(report.income.creditMemos.total)})
                      </Link>
                    </TableCell>
                  </TableRow>
                )}
                {report.income.contraBills.accounts.map((c) => (
                  <TableRow key={`contra-${c.accountId}`}>
                    <TableCell className="text-slate-700">
                      <Link
                        href={
                          `/reports/profit-loss/${c.accountId}${revQs.toString() ? `?${revQs.toString()}` : ''}` as never
                        }
                        className="underline-offset-2 hover:underline"
                      >
                        Less bills — {c.accountName}
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">
                        posted bill lines on this revenue account —
                        contra-revenue
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {c.entryCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <Link
                        href={
                          `/reports/profit-loss/${c.accountId}${revQs.toString() ? `?${revQs.toString()}` : ''}` as never
                        }
                        className="text-red-700 underline underline-offset-2 hover:text-red-900"
                      >
                        ({formatMoney(c.amount)})
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {(report.income.creditMemos.total > 0 ||
                  report.income.contraBills.total > 0) && (
                  <TableRow>
                    <TableCell className="font-medium text-slate-900">
                      Net revenue
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums font-semibold">
                      <Link
                        href={revenueHref() as never}
                        className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                      >
                        {formatMoney(report.income.total)}
                      </Link>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          {report.income.uncategorized.total > 0 &&
            report.income.accounts.length === 0 && (
              <p className="p-4 text-xs text-slate-500">
                Set a “Revenue category” on invoices to split revenue by service
                type (Roofing / Waterproofing / Windows &amp; Doors / …) here.
              </p>
            )}
        </CardContent>
      </Card>

      <AccountSection
        id="cogs"
        title="Cost of Goods Sold"
        total={report.cogs.total}
        totalHref={expensesHref}
        rows={rollUpSubaccounts(report.cogs.accounts, parentCategoryOf, accountNameOf)}
        filters={filters}
        emptyMessage="No COGS entries categorized in this range."
      />

      <AccountSection
        id="opex"
        title="Operating Expense"
        total={report.opex.total}
        totalHref={expensesHref}
        rows={rollUpSubaccounts(report.opex.accounts, parentCategoryOf, accountNameOf)}
        filters={filters}
        emptyMessage="No operating expense entries categorized in this range."
      />

      <Card id="bottom-line">
        <CardHeader>
          <CardTitle>Bottom line</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-6">
          <Row
            label="Revenue"
            value={formatMoney(report.income.total)}
            href={report.income.total > 0 ? revenueHref() : undefined}
          />
          <Row
            label="− Cost of Goods Sold"
            value={formatMoney(report.cogs.total)}
            tone="amber"
            href="#cogs"
          />
          <Row
            label="= Gross profit"
            value={formatMoney(report.grossProfit)}
            tone={grossSign ? 'emerald' : 'red'}
            bold
          />
          <Row
            label="− Operating expense"
            value={formatMoney(report.opex.total)}
            tone="amber"
            href="#opex"
          />
          <Row
            label="= Net income"
            value={formatMoney(report.netIncome)}
            tone={netSign ? 'emerald' : 'red'}
            bold
            border
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue recognition — WIP (% complete)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-6">
          {report.wip.projectCount === 0 ? (
            <p className="text-sm text-slate-500">
              No active contracts with a contract value to report. Add a
              contract value and cost estimate to a project to see earned
              revenue here.
            </p>
          ) : !report.wip.costBasisAvailable ? (
            <p className="text-sm text-slate-500">
              Earned revenue needs a cost basis. Your{' '}
              {report.wip.projectCount} contract
              {report.wip.projectCount === 1 ? '' : 's'} have contract values
              and billings, but no job costs or cost estimates yet — so
              percent-complete (and therefore earned revenue) can&apos;t be
              computed. Add cost estimates or post job costs to projects, and
              this section will show earned vs billed and the
              contract-asset / deferred-revenue position. Until then the P&amp;L
              above reflects billed revenue.
            </p>
          ) : (
            <>
              <p className="-mt-1 text-xs text-slate-500">
                Across {report.wip.projectCount} contract
                {report.wip.projectCount === 1 ? '' : 's'} — cumulative as of{' '}
                {report.wip.asOf.slice(0, 10)}, a percentage-of-completion view
                that is intentionally <em>not</em> bounded by the date range
                above.{' '}
                <Link
                  href={'/reports/wip' as never}
                  className="underline underline-offset-2"
                >
                  Full WIP schedule →
                </Link>
              </p>
              <Row
                label="Earned to date (% complete × contract)"
                value={formatMoney(report.wip.earnedRevenue)}
              />
              <Row
                label={`Billed to date (${exTax})`}
                value={formatMoney(report.wip.billedToDate)}
              />
              <Row
                label={
                  report.wip.overUnderBilled >= 0
                    ? '= Under-billed — contract asset (unbilled)'
                    : '= Over-billed — deferred revenue (liability)'
                }
                value={formatMoney(report.wip.overUnderBilled)}
                tone={report.wip.overUnderBilled >= 0 ? 'emerald' : 'amber'}
                bold
                border
              />
              <p className="text-xs text-slate-500">
                {report.wip.overUnderBilled >= 0
                  ? `${formatMoney(report.wip.overUnderBilled)} of completed work is not yet invoiced — recognize as an unbilled receivable (contract asset).`
                  : `${formatMoney(-report.wip.overUnderBilled)} invoiced ahead of work completed — carry as deferred revenue (a liability) until earned.`}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  );
}

type SectionAccount = {
  accountId: string;
  accountName: string;
  amount: number;
  entryCount: number;
};

type SectionRow = {
  key: string;
  /** Drill-down target — absent on group-header / subtotal rows. */
  accountId?: string;
  name: string;
  amount: number | null;
  entryCount: number | null;
  indent: boolean;
  subtotal: boolean;
};

/**
 * QB-style rollup: top-level categories A→Z; a parent with active
 * subaccounts renders its own line (when it has direct activity), then the
 * subaccounts indented, then a bold "Total parent" row. A parent with no
 * direct activity but active subs gets a non-linking header line.
 */
function rollUpSubaccounts(
  accounts: SectionAccount[],
  parentCategoryOf: Map<string, string>,
  accountNameOf: (id: string) => string,
): SectionRow[] {
  const byId = new Map(accounts.map((a) => [a.accountId, a]));
  const childrenOf = new Map<string, SectionAccount[]>();
  const tops: Array<{ id: string; name: string }> = [];
  const seenTop = new Set<string>();

  for (const a of accounts) {
    const parentId = parentCategoryOf.get(a.accountId);
    if (parentId) {
      const arr = childrenOf.get(parentId) ?? [];
      arr.push(a);
      childrenOf.set(parentId, arr);
      // The parent anchors the group even without direct activity.
      if (!seenTop.has(parentId)) {
        seenTop.add(parentId);
        tops.push({ id: parentId, name: byId.get(parentId)?.accountName ?? accountNameOf(parentId) });
      }
    } else if (!seenTop.has(a.accountId)) {
      seenTop.add(a.accountId);
      tops.push({ id: a.accountId, name: a.accountName });
    }
  }
  tops.sort((x, y) => x.name.localeCompare(y.name));

  const rows: SectionRow[] = [];
  for (const t of tops) {
    const own = byId.get(t.id);
    const kids = (childrenOf.get(t.id) ?? []).sort((x, y) =>
      x.accountName.localeCompare(y.accountName),
    );
    if (kids.length === 0) {
      if (own) {
        rows.push({
          key: t.id,
          accountId: t.id,
          name: own.accountName,
          amount: own.amount,
          entryCount: own.entryCount,
          indent: false,
          subtotal: false,
        });
      }
      continue;
    }
    // Group: parent line (linked when it has direct activity), indented subs,
    // bold total.
    rows.push({
      key: t.id,
      accountId: own ? t.id : undefined,
      name: t.name,
      amount: own ? own.amount : null,
      entryCount: own ? own.entryCount : null,
      indent: false,
      subtotal: false,
    });
    for (const k of kids) {
      rows.push({
        key: k.accountId,
        accountId: k.accountId,
        name: k.accountName,
        amount: k.amount,
        entryCount: k.entryCount,
        indent: true,
        subtotal: false,
      });
    }
    rows.push({
      key: `${t.id}:total`,
      name: `Total ${t.name}`,
      amount: (own?.amount ?? 0) + kids.reduce((s, k) => s + k.amount, 0),
      entryCount:
        (own?.entryCount ?? 0) + kids.reduce((s, k) => s + k.entryCount, 0),
      indent: false,
      subtotal: true,
    });
  }
  return rows;
}

function AccountSection({
  id,
  title,
  total,
  totalHref,
  rows,
  filters,
  emptyMessage,
}: {
  id?: string;
  title: string;
  total: number;
  totalHref?: string;
  rows: SectionRow[];
  filters: { from: string; to: string };
  emptyMessage: string;
}) {
  const qs = new URLSearchParams();
  if (filters.from) qs.set('from', filters.from);
  if (filters.to) qs.set('to', filters.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle>
          {title} —{' '}
          {totalHref ? (
            <Link
              href={totalHref as never}
              className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
            >
              {formatMoney(total)}
            </Link>
          ) : (
            formatMoney(total)
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">{emptyMessage}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell
                    className={
                      r.subtotal ? 'font-semibold text-slate-900' : undefined
                    }
                  >
                    {r.indent && (
                      <span className="mr-1.5 pl-4 text-slate-400">↳</span>
                    )}
                    {r.accountId ? (
                      <Link
                        href={
                          `/reports/profit-loss/${r.accountId}${suffix}` as never
                        }
                        className="text-slate-900 underline-offset-2 hover:underline"
                      >
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {r.entryCount ?? ''}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.subtotal ? 'font-semibold' : 'font-medium'
                    }`}
                  >
                    {r.amount === null ? (
                      ''
                    ) : r.accountId ? (
                      <Link
                        href={
                          `/reports/profit-loss/${r.accountId}${suffix}` as never
                        }
                        className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                      >
                        {formatMoney(r.amount)}
                      </Link>
                    ) : (
                      formatMoney(r.amount)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  tone,
  bold,
  border,
  href,
}: {
  label: string;
  value: string;
  tone?: 'emerald' | 'red' | 'amber';
  bold?: boolean;
  border?: boolean;
  href?: string;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'red'
        ? 'text-red-600'
        : tone === 'amber'
          ? 'text-amber-700'
          : 'text-slate-900';
  const hoverClass =
    tone === 'emerald'
      ? 'hover:text-emerald-900'
      : tone === 'red'
        ? 'hover:text-red-800'
        : tone === 'amber'
          ? 'hover:text-amber-900'
          : 'hover:text-blue-900';
  return (
    <div
      className={`flex items-baseline justify-between gap-4 text-sm ${border ? 'border-t border-slate-200 pt-2 mt-2' : ''}`}
    >
      <span className={`${bold ? 'font-semibold' : ''} text-slate-700`}>{label}</span>
      {href ? (
        <Link
          href={href as never}
          className={`tabular-nums ${bold ? 'text-base font-semibold' : 'font-medium'} ${tone ? toneClass : 'text-blue-700'} underline underline-offset-2 ${hoverClass}`}
        >
          {value}
        </Link>
      ) : (
        <span
          className={`tabular-nums ${bold ? 'text-base font-semibold' : 'font-medium'} ${toneClass}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  hint,
  highlight,
  valueClassName,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
  valueClassName?: string;
  href?: string;
}) {
  const card = (
    <Card
      className={`${highlight ? 'border-slate-300' : ''} ${href ? 'transition-colors hover:border-blue-300 hover:bg-blue-50/40' : ''}`}
    >
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          {label}
          {href && <span className="text-blue-600"> →</span>}
        </p>
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
  return href ? (
    <Link href={href as never} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}
