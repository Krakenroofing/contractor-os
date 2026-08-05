import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { getTrialBalance } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

const GROUP_ORDER = [
  'asset',
  'liability',
  'equity',
  'income',
  'cogs',
  'opex',
  'vat_tax',
] as const;
const GROUP_LABEL: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  cogs: 'Cost of Goods Sold',
  opex: 'Operating Expense',
  vat_tax: 'VAT / Tax',
};

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const asOf = typeof sp.asOf === 'string' && sp.asOf ? sp.asOf : null;

  const tb = await getTrialBalance(company.id, asOf);
  const balanced = Math.abs(tb.difference) < 0.005;

  const byGroup = new Map<string, typeof tb.rows>();
  for (const r of tb.rows) {
    const arr = byGroup.get(r.rollupGroup) ?? [];
    arr.push(r);
    byGroup.set(r.rollupGroup, arr);
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={{ pathname: '/dashboard' }}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            Trial Balance
          </h1>
          <p className="text-sm text-slate-500">
            Every account&apos;s debit/credit totals from the general ledger
            {asOf ? ` as of ${asOf}` : ' (all dates)'}. Built from
            double-entry journal entries, so total debits equal total credits.
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
            href={`/reports/trial-balance/export.csv${asOf ? `?asOf=${asOf}` : ''}`}
            className="text-sm text-blue-700 underline underline-offset-2"
          >
            CSV
          </a>
        </form>
      </div>

      <div
        className={`rounded-md border px-4 py-2 text-sm ${
          balanced
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        {tb.rows.length === 0
          ? 'No journal entries posted yet. Post opening balances or adjustments from the General Ledger, or wait for auto-posting (Phase 3.2).'
          : balanced
            ? `In balance — debits ${formatMoney(tb.totalDebit)} = credits ${formatMoney(tb.totalCredit)}.`
            : `Out of balance by ${formatMoney(tb.difference)} — debits ${formatMoney(tb.totalDebit)} vs credits ${formatMoney(tb.totalCredit)}.`}
      </div>

      {tb.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => (
                  <GroupRows
                    key={g}
                    label={GROUP_LABEL[g] ?? g}
                    rows={byGroup.get(g)!}
                    asOf={asOf}
                  />
                ))}
                <TableRow className="border-t-2 border-slate-300">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMoney(tb.totalDebit)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMoney(tb.totalCredit)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GroupRows({
  label,
  rows,
  asOf,
}: {
  label: string;
  asOf: string | null;
  rows: Array<{
    accountId: string;
    code: string | null;
    name: string;
    debit: number;
    credit: number;
  }>;
}) {
  return (
    <>
      <TableRow className="bg-slate-50">
        <TableCell colSpan={3} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </TableCell>
      </TableRow>
      {rows.map((r) => (
        <TableRow key={r.accountId}>
          <TableCell>
            {r.code ? <span className="font-mono text-slate-500">{r.code} </span> : null}
            <Link
              href={`/reports/general-ledger?accountId=${r.accountId}${asOf ? `&to=${asOf}` : ''}`}
              className="text-blue-700 hover:underline"
            >
              {r.name}
            </Link>
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {r.debit !== 0 ? formatMoney(r.debit) : ''}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {r.credit !== 0 ? formatMoney(r.credit) : ''}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
