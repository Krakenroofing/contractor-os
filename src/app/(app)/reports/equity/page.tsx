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
import { buildEquityStatement } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

// Statement of changes in (shareholders') equity over a period: opening
// equity + net income + owner contributions − draws = closing equity. Reads
// from the general ledger, so it ties to the Balance Sheet equity section.
export default async function EquityStatementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const from = typeof sp.from === 'string' && sp.from ? sp.from : null;
  const to = typeof sp.to === 'string' && sp.to ? sp.to : null;

  const eq = await buildEquityStatement(company.id, { from, to });
  const empty =
    eq.rows.length === 0 &&
    eq.openingTotal === 0 &&
    eq.closingTotal === 0 &&
    eq.netIncome === 0;

  const periodLabel =
    from && to
      ? `${from} → ${to}`
      : to
        ? `through ${to}`
        : from
          ? `from ${from}`
          : 'all dates';

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={{ pathname: '/reports' }}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← All reports
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            Statement of Shareholders&rsquo; Equity
          </h1>
          <p className="text-sm text-slate-500">
            Changes in equity ({periodLabel}) — read from the general ledger.
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
            href={`/reports/equity/export.csv${
              from || to
                ? `?${from ? `from=${from}` : ''}${from && to ? '&' : ''}${to ? `to=${to}` : ''}`
                : ''
            }`}
            className="text-sm text-blue-700 underline underline-offset-2"
          >
            CSV
          </a>
        </form>
      </div>

      {empty ? (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nothing posted to the ledger for this period yet. If activity is
          missing, run &ldquo;Rebuild from invoices &amp; payments&rdquo; on the
          General Ledger.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Equity roll-forward</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 text-left font-medium">Component</th>
                  <th className="px-4 py-2 text-right font-medium">Opening</th>
                  <th className="px-4 py-2 text-right font-medium">Change</th>
                  <th className="px-4 py-2 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody>
                {eq.rows.map((r) => (
                  <tr key={r.accountId} className="border-b border-slate-100">
                    <td className="px-4 py-2 text-slate-800">
                      <Link
                        href={`/reports/general-ledger?accountId=${r.accountId}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`}
                        className="text-blue-700 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {formatMoney(r.opening)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        r.movement < 0 ? 'text-red-600' : 'text-slate-800'
                      }`}
                    >
                      {formatMoney(r.movement)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {formatMoney(r.closing)}
                    </td>
                  </tr>
                ))}
                {/* Retained earnings / accumulated net income */}
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-800">
                    Retained earnings (accumulated)
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {formatMoney(eq.openingRetained)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                    {formatMoney(eq.netIncome)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">
                    {formatMoney(eq.closingRetained)}
                  </td>
                </tr>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="px-4 py-2 text-slate-900">Total equity</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(eq.openingTotal)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(eq.netChange)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(eq.closingTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-slate-500">
        <strong>Change</strong> on each equity account is the net of owner
        contributions (positive) and draws / distributions (negative) during the
        period. <strong>Net income</strong> for the period rolls into retained
        earnings. Opening + change = closing for every row, and the totals tie to
        the Balance Sheet equity section at each date.
      </p>
    </div>
  );
}
