import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { buildBalanceSheet, type BalanceSheetLine } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const asOf = typeof sp.asOf === 'string' && sp.asOf ? sp.asOf : null;

  const bs = await buildBalanceSheet(company.id, asOf);
  const balanced = Math.abs(bs.difference) < 0.005;
  const empty =
    bs.assets.length === 0 &&
    bs.liabilities.length === 0 &&
    bs.equity.length === 0 &&
    bs.netIncome === 0;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={{ pathname: '/accounting/journal' }}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← General Ledger
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            Balance Sheet
          </h1>
          <p className="text-sm text-slate-500">
            Financial position{asOf ? ` as of ${asOf}` : ' (all dates)'} — read
            from the general ledger.
          </p>
        </div>
        <form className="flex items-end gap-2">
          <div>
            <Label htmlFor="asOf">As of</Label>
            <Input id="asOf" name="asOf" type="date" defaultValue={asOf ?? ''} />
          </div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
          <a
            href={`/reports/balance-sheet/export.csv${asOf ? `?asOf=${asOf}` : ''}`}
            className="text-sm text-blue-700 underline underline-offset-2"
          >
            CSV
          </a>
        </form>
      </div>

      {empty ? (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nothing posted to the ledger yet. Run “Rebuild from invoices &amp;
          payments” on the General Ledger first.
        </div>
      ) : (
        <>
          <div
            className={`rounded-md border px-4 py-2 text-sm ${
              balanced
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {balanced
              ? `Balanced — assets ${formatMoney(bs.totalAssets)} = liabilities + equity ${formatMoney(bs.totalLiabilities + bs.totalEquity)}.`
              : `Off by ${formatMoney(bs.difference)} — assets ${formatMoney(bs.totalAssets)} vs liabilities + equity ${formatMoney(bs.totalLiabilities + bs.totalEquity)}.`}
          </div>

          <Section
            title="Assets"
            lines={bs.assets}
            total={bs.totalAssets}
            asOf={asOf}
            drillHref={drillHref('assets', asOf)}
          />
          <Section
            title="Liabilities"
            lines={bs.liabilities}
            total={bs.totalLiabilities}
            asOf={asOf}
            drillHref={drillHref('liabilities', asOf)}
          />

          <Card>
            <CardHeader>
              <CardTitle>
                Equity —{' '}
                <Link
                  href={drillHref('equity', asOf) as never}
                  className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                >
                  {formatMoney(bs.totalEquity)}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-1.5">
              {bs.equity.map((l) => (
                <Row
                  key={l.accountId}
                  label={l.name}
                  value={l.amount}
                  href={glHref(l.accountId, asOf)}
                />
              ))}
              <Row
                label="Net income (current)"
                value={bs.netIncome}
                href={drillHref('net-income', asOf)}
              />
              <div className="mt-2 border-t border-slate-200 pt-2">
                <Row
                  label="Total equity"
                  value={bs.totalEquity}
                  bold
                  href={drillHref('equity', asOf)}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function glHref(accountId: string, asOf: string | null): string {
  return `/reports/general-ledger?accountId=${accountId}${asOf ? `&to=${asOf}` : ''}`;
}

function drillHref(section: string, asOf: string | null): string {
  return `/reports/balance-sheet/${section}${asOf ? `?asOf=${asOf}` : ''}`;
}

function Section({
  title,
  lines,
  total,
  asOf,
  drillHref,
}: {
  title: string;
  lines: BalanceSheetLine[];
  total: number;
  asOf: string | null;
  drillHref: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} —{' '}
          <Link
            href={drillHref as never}
            className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            {formatMoney(total)}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-1.5">
        {lines.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          lines.map((l) => (
            <Row
              key={l.accountId}
              label={l.name}
              value={l.amount}
              href={glHref(l.accountId, asOf)}
            />
          ))
        )}
        <div className="mt-2 border-t border-slate-200 pt-2">
          <Row
            label={`Total ${title.toLowerCase()}`}
            value={total}
            bold
            href={drillHref}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  bold,
  href,
}: {
  label: string;
  value: number;
  bold?: boolean;
  href?: string;
}) {
  // Convention (Chris, 2026-08-21): the NUMBER is the clickable element, and
  // every clickable number across reports is blue + underlined.
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className={bold ? 'font-semibold text-slate-900' : 'text-slate-700'}>
        {label}
      </span>
      {href ? (
        <Link
          href={href as never}
          className={`tabular-nums ${bold ? 'font-semibold' : 'font-medium'} text-blue-700 underline underline-offset-2 hover:text-blue-900`}
        >
          {formatMoney(value)}
        </Link>
      ) : (
        <span
          className={`tabular-nums ${bold ? 'font-semibold' : 'font-medium'} text-slate-900`}
        >
          {formatMoney(value)}
        </span>
      )}
    </div>
  );
}
