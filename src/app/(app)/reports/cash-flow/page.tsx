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
import { buildCashFlow, type CashFlowSection } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const from = str(sp.from) || null;
  const to = str(sp.to) || null;

  const cf = await buildCashFlow(company.id, { from, to });
  const reconciles =
    Math.abs(
      cf.operating.total + cf.investing.total + cf.financing.total - cf.netChange,
    ) < 0.01;
  const empty =
    cf.operating.lines.length === 0 &&
    cf.investing.lines.length === 0 &&
    cf.financing.lines.length === 0;

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
            Cash Flow
          </h1>
          <p className="text-sm text-slate-500">
            Cash in/out by activity, from the general ledger
            {from || to
              ? ` (${from ?? 'start'} → ${to ?? 'today'})`
              : ' (all dates)'}
            .
          </p>
        </div>
        <form className="flex items-end gap-2">
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={from ?? ''} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={to ?? ''} />
          </div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
          <a
            href={`/reports/cash-flow/export.csv${from || to ? `?${from ? `from=${from}&` : ''}${to ? `to=${to}` : ''}` : ''}`}
            className="text-sm text-blue-700 underline underline-offset-2"
          >
            CSV
          </a>
        </form>
      </div>

      {empty ? (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No cash movements in the ledger for this range. Run “Rebuild from
          invoices &amp; payments” on the General Ledger first.
        </div>
      ) : (
        <>
          <Section title="Operating activities" section={cf.operating} />
          <Section title="Investing activities" section={cf.investing} />
          <Section title="Financing activities" section={cf.financing} />

          <Card>
            <CardContent className="p-6 space-y-1.5">
              <Row label="Net change in cash" value={cf.netChange} bold />
              <Row label="Opening cash" value={cf.openingCash} />
              <div className="mt-2 border-t border-slate-200 pt-2">
                <Row label="Closing cash" value={cf.closingCash} bold />
              </div>
              {!reconciles && (
                <p className="pt-2 text-xs text-amber-700">
                  Sections don&apos;t fully reconcile to the net change — likely
                  a rounding edge.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  section,
}: {
  title: string;
  section: CashFlowSection;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-3">
          <span>{title}</span>
          <span className="text-sm tabular-nums text-slate-600">
            {formatMoney(section.total)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-1.5">
        {section.lines.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          section.lines.map((l) => (
            <Row key={l.accountId} label={l.name} value={l.amount} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className={bold ? 'font-semibold text-slate-900' : 'text-slate-700'}>
        {label}
      </span>
      <span
        className={`tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${
          value < 0 ? 'text-red-600' : 'text-slate-900'
        }`}
      >
        {formatMoney(value)}
      </span>
    </div>
  );
}
