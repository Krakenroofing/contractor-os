import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  buildBalanceSheet,
  type BalanceSheetLine,
} from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

// Balance-sheet drill: every aggregated total on the statement clicks into
// the component accounts behind it (Chris, 2026-08-21). "net-income" is the
// interesting one — its components (income & expense accounts) never appear
// on the statement itself.
const SECTIONS = ['assets', 'liabilities', 'equity', 'net-income'] as const;
type Section = (typeof SECTIONS)[number];

const TITLE: Record<Section, string> = {
  assets: 'Total assets — components',
  liabilities: 'Total liabilities — components',
  equity: 'Total equity — components',
  'net-income': 'Net income (current) — components',
};

export default async function BalanceSheetDrillPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) {
    redirect('/dashboard');
  }
  const { section: raw } = await params;
  if (!SECTIONS.includes(raw as Section)) notFound();
  const section = raw as Section;

  const company = await getActiveCompany();
  const sp = await searchParams;
  const asOf = typeof sp.asOf === 'string' && sp.asOf ? sp.asOf : null;
  const bs = await buildBalanceSheet(company.id, asOf);

  const glHref = (accountId: string) =>
    `/reports/general-ledger?accountId=${accountId}${asOf ? `&to=${asOf}` : ''}`;
  const suffix = asOf ? `?asOf=${asOf}` : '';

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <Breadcrumbs
        items={[
          { href: `/reports/balance-sheet${suffix}`, label: 'Balance Sheet' },
          { label: TITLE[section] },
        ]}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {TITLE[section]}
          </h1>
          <p className="text-sm text-slate-500">
            {company.name}
            {asOf ? ` — as of ${asOf}` : ' — all dates'} · each amount drills
            into that account&apos;s ledger detail.
          </p>
        </div>
        <Link href={{ pathname: '/reports/balance-sheet', query: asOf ? { asOf } : {} }}>
          <Button variant="outline" size="sm">
            ← Balance Sheet
          </Button>
        </Link>
      </div>

      {section === 'assets' && (
        <LinesCard
          title={`Assets — ${formatMoney(bs.totalAssets)}`}
          lines={bs.assets}
          total={bs.totalAssets}
          glHref={glHref}
        />
      )}
      {section === 'liabilities' && (
        <LinesCard
          title={`Liabilities — ${formatMoney(bs.totalLiabilities)}`}
          lines={bs.liabilities}
          total={bs.totalLiabilities}
          glHref={glHref}
        />
      )}
      {section === 'equity' && (
        <Card>
          <CardHeader>
            <CardTitle>Equity — {formatMoney(bs.totalEquity)}</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-1.5">
            {bs.equity.map((l) => (
              <DrillRow key={l.accountId} line={l} href={glHref(l.accountId)} />
            ))}
            <DrillRow
              line={{
                accountId: 'net-income',
                name: 'Net income (current)',
                amount: bs.netIncome,
              }}
              href={`/reports/balance-sheet/net-income${suffix}`}
            />
            <TotalRow label="Total equity" value={bs.totalEquity} />
          </CardContent>
        </Card>
      )}
      {section === 'net-income' && (
        <>
          <LinesCard
            title={`Income — ${formatMoney(
              bs.incomeLines.reduce((s, l) => s + l.amount, 0),
            )}`}
            lines={bs.incomeLines}
            total={bs.incomeLines.reduce((s, l) => s + l.amount, 0)}
            glHref={glHref}
          />
          <LinesCard
            title={`Expenses — ${formatMoney(
              bs.expenseLines.reduce((s, l) => s + l.amount, 0),
            )}`}
            lines={bs.expenseLines}
            total={bs.expenseLines.reduce((s, l) => s + l.amount, 0)}
            glHref={glHref}
          />
          <Card>
            <CardContent className="p-6">
              <TotalRow label="Net income (current)" value={bs.netIncome} />
              <p className="mt-2 text-xs text-slate-500">
                GL basis: every income account minus every COGS / operating
                expense account, as posted to the ledger
                {asOf ? ` through ${asOf}` : ''}. The P&amp;L report shows the
                same activity organized by operational source.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function LinesCard({
  title,
  lines,
  total,
  glHref,
}: {
  title: string;
  lines: BalanceSheetLine[];
  total: number;
  glHref: (accountId: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-1.5">
        {lines.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          lines.map((l) => (
            <DrillRow key={l.accountId} line={l} href={glHref(l.accountId)} />
          ))
        )}
        <TotalRow label="Total" value={total} />
      </CardContent>
    </Card>
  );
}

function DrillRow({ line, href }: { line: BalanceSheetLine; href: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-slate-700">{line.name}</span>
      <Link
        href={href as never}
        className="tabular-nums font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
      >
        {formatMoney(line.amount)}
      </Link>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-slate-200 pt-2 text-sm">
      <span className="font-semibold text-slate-900">{label}</span>
      <span className="tabular-nums font-semibold text-slate-900">
        {formatMoney(value)}
      </span>
    </div>
  );
}
