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
import { buildProfitLossReport } from '@/lib/data/profit-loss';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { ReportShell } from '@/modules/reports/components/report-shell';

export const dynamic = 'force-dynamic';

export default async function ProfitLossReportPage({
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
    buildProfitLossReport(company.id, filters),
    listProjects(company.id),
  ]);

  const netSign = report.netIncome >= 0;
  const grossSign = report.grossProfit >= 0;

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
          hint={`${report.income.invoiceCount} invoice${report.income.invoiceCount === 1 ? '' : 's'} (ex-VAT)`}
          highlight
        />
        <KPI
          label="COGS"
          value={formatMoney(report.cogs.total)}
          hint={`${report.cogs.accounts.length} categor${report.cogs.accounts.length === 1 ? 'y' : 'ies'}`}
          valueClassName="text-amber-700"
        />
        <KPI
          label="Gross profit"
          value={formatMoney(report.grossProfit)}
          hint={`${report.grossMarginPercent.toFixed(1)}% margin`}
          valueClassName={
            grossSign ? 'text-emerald-700' : 'text-red-600'
          }
        />
        <KPI
          label="Operating expense"
          value={formatMoney(report.opex.total)}
          hint={`${report.opex.accounts.length} categor${report.opex.accounts.length === 1 ? 'y' : 'ies'}`}
          valueClassName="text-amber-700"
        />
        <KPI
          label="Net income"
          value={formatMoney(report.netIncome)}
          valueClassName={
            netSign ? 'text-emerald-700' : 'text-red-600'
          }
          highlight
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
            <CardTitle>Income — {formatMoney(report.income.total)}</CardTitle>
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
                  <TableHead className="text-right">Amount (ex-VAT)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.income.accounts.map((a) => (
                  <TableRow key={a.accountId}>
                    <TableCell className="text-slate-900">
                      {a.accountName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {a.entryCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(a.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                {report.income.uncategorized.total > 0 && (
                  <TableRow>
                    <TableCell className="text-amber-800">
                      Uncategorized revenue
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {report.income.uncategorized.invoiceCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-amber-800">
                      {formatMoney(report.income.uncategorized.total)}
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
        title={`Cost of Goods Sold — ${formatMoney(report.cogs.total)}`}
        accounts={report.cogs.accounts}
        filters={filters}
        emptyMessage="No COGS entries categorized in this range."
      />

      <AccountSection
        title={`Operating Expense — ${formatMoney(report.opex.total)}`}
        accounts={report.opex.accounts}
        filters={filters}
        emptyMessage="No operating expense entries categorized in this range."
      />

      <Card>
        <CardHeader>
          <CardTitle>Bottom line</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-6">
          <Row label="Revenue" value={formatMoney(report.income.total)} />
          <Row
            label="− Cost of Goods Sold"
            value={formatMoney(report.cogs.total)}
            tone="amber"
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
                label="Billed to date (ex-VAT)"
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

function AccountSection({
  title,
  accounts,
  filters,
  emptyMessage,
}: {
  title: string;
  accounts: Array<{
    accountId: string;
    accountName: string;
    amount: number;
    entryCount: number;
  }>;
  filters: { from: string; to: string };
  emptyMessage: string;
}) {
  const qs = new URLSearchParams();
  if (filters.from) qs.set('from', filters.from);
  if (filters.to) qs.set('to', filters.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {accounts.length === 0 ? (
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
              {accounts.map((a) => (
                <TableRow key={a.accountId}>
                  <TableCell>
                    <Link
                      href={
                        `/reports/profit-loss/${a.accountId}${suffix}` as never
                      }
                      className="text-slate-900 underline-offset-2 hover:underline"
                    >
                      {a.accountName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {a.entryCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatMoney(a.amount)}
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
}: {
  label: string;
  value: string;
  tone?: 'emerald' | 'red' | 'amber';
  bold?: boolean;
  border?: boolean;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'red'
        ? 'text-red-600'
        : tone === 'amber'
          ? 'text-amber-700'
          : 'text-slate-900';
  return (
    <div
      className={`flex items-baseline justify-between gap-4 text-sm ${border ? 'border-t border-slate-200 pt-2 mt-2' : ''}`}
    >
      <span className={`${bold ? 'font-semibold' : ''} text-slate-700`}>{label}</span>
      <span
        className={`tabular-nums ${bold ? 'text-base font-semibold' : 'font-medium'} ${toneClass}`}
      >
        {value}
      </span>
    </div>
  );
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
