import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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
import {
  getGeneralLedgerDetail,
  getTrialBalance,
} from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

export default async function GeneralLedgerDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const from = str(sp.from) || null;
  const to = str(sp.to) || null;
  const accountId = str(sp.accountId) || null;

  const [tb, detail] = await Promise.all([
    getTrialBalance(company.id, to),
    getGeneralLedgerDetail(company.id, { from, to, accountId }),
  ]);

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (accountId) p.set('accountId', accountId);
    for (const [k, v] of Object.entries(extra)) v ? p.set(k, v) : p.delete(k);
    return p.toString();
  };

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link
          href={{ pathname: '/accounting/journal' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← General Ledger
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          GL Detail
        </h1>
        <p className="text-sm text-slate-500">
          Every posting per account, in date order, with a running balance.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid grid-cols-1 gap-3 md:grid-cols-4 items-end">
            <div className="md:col-span-2">
              <Label htmlFor="accountId">Account</Label>
              <Select id="accountId" name="accountId" defaultValue={accountId ?? ''}>
                <option value="">All accounts</option>
                {tb.rows.map((r) => (
                  <option key={r.accountId} value={r.accountId}>
                    {r.code ? `${r.code} ` : ''}
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={from ?? ''} />
            </div>
            <div>
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={to ?? ''} />
            </div>
            <div className="flex items-center gap-2 md:col-span-4">
              <Button type="submit" variant="outline">
                Apply
              </Button>
              <a
                href={`/reports/general-ledger/export.csv?${qs({})}`}
                className="text-sm text-blue-700 underline underline-offset-2"
              >
                CSV
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      {detail.accounts.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No postings in the ledger for this filter. Run “Rebuild from invoices
          &amp; payments” on the General Ledger first.
        </div>
      ) : (
        detail.accounts.map((a) => (
          <Card key={a.accountId}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-3">
                <span>
                  {a.code ? (
                    <span className="font-mono text-slate-400">{a.code} </span>
                  ) : null}
                  {a.name}
                </span>
                <span className="text-sm tabular-nums text-slate-600">
                  {formatMoney(a.closingBalance)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Date</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {from && (
                    <TableRow className="bg-slate-50">
                      <TableCell colSpan={4} className="text-xs text-slate-500">
                        Opening balance
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-500">
                        {formatMoney(a.openingBalance)}
                      </TableCell>
                    </TableRow>
                  )}
                  {a.lines.map((l, i) => (
                    <TableRow key={`${l.entryId}-${i}`}>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {l.date}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        <Link
                          href={
                            `/accounting/journal?entry=${l.entryId}` as never
                          }
                          className="underline-offset-2 hover:underline"
                          title="View the full journal entry"
                        >
                          {l.memo ?? '(no memo)'}
                        </Link>
                        {l.description ? (
                          <span className="ml-2 text-xs text-slate-400">
                            {l.description}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.debit !== 0 ? formatMoney(l.debit) : ''}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.credit !== 0 ? formatMoney(l.credit) : ''}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(l.runningBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-slate-200">
                    <TableCell colSpan={2} className="text-xs font-medium text-slate-600">
                      {a.lines.length} line{a.lines.length === 1 ? '' : 's'}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(a.totalDebit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(a.totalCredit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(a.closingBalance)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
