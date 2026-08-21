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
import { Badge } from '@/components/ui/badge';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { searchBanking } from '@/lib/data/banking-search';
import { BankingSearchBox } from '@/modules/banking/components/banking-search-box';

export const dynamic = 'force-dynamic';

export default async function BankingSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'bank_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const showReceipts = canView(role, 'receipts');

  const result = q.trim()
    ? await searchBanking(company.id, q)
    : null;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link
          href={{ pathname: '/banking' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Banking
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Search banking &amp; receipts
        </h1>
        <p className="text-sm text-slate-500">
          Searches every bank transaction (description, payee, memo,
          reference) and receipt / bill (vendor, notes, line descriptions) —
          and amounts: &ldquo;1,500&rdquo;, &ldquo;$1500&rdquo; and
          &ldquo;1500.00&rdquo; all find the same money. A number without
          cents matches anything in that dollar.
        </p>
      </div>

      <BankingSearchBox initialQuery={q} autoFocus />

      {result && (
        <>
          <p className="text-sm text-slate-600">
            {result.transactions.length + result.receipts.length === 0
              ? `Nothing found for “${result.query}”.`
              : `${result.transactions.length} bank transaction${result.transactions.length === 1 ? '' : 's'}${showReceipts ? ` · ${result.receipts.length} receipt${result.receipts.length === 1 ? '' : 's'}` : ''} for “${result.query}”${result.numeric !== null ? ' (matched as an amount too)' : ''}.`}
            {result.truncated && ' Showing the first 100 of each — narrow the search.'}
          </p>

          {result.transactions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Bank transactions</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="w-24">Ref</TableHead>
                      <TableHead className="text-right w-32">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="tabular-nums text-slate-700">
                          {t.date}
                        </TableCell>
                        <TableCell className="max-w-md truncate">
                          <Link
                            href={{ pathname: `/banking/transactions/${t.id}` }}
                            className="hover:underline"
                          >
                            {t.payee || t.description}
                          </Link>{' '}
                          {t.isIgnored && <Badge tone="slate">Ignored</Badge>}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {t.accountName}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {t.reference ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          <Link
                            href={{
                              pathname: `/banking/accounts/${t.bankAccountId}`,
                              query: { txn: t.id },
                            }}
                            title="Open in the register to edit"
                            className={`underline underline-offset-2 ${t.amount > 0 ? 'text-emerald-700 hover:text-emerald-900' : 'text-blue-700 hover:text-blue-900'}`}
                          >
                            {formatMoney(t.amount)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {showReceipts && result.receipts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Receipts / bills</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right w-32">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.receipts.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums text-slate-700">
                          {r.date}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={{ pathname: `/banking/receipts/${r.id}` }}
                            className="hover:underline"
                          >
                            {r.vendorName ?? '— no vendor —'}
                          </Link>
                        </TableCell>
                        <TableCell className="capitalize text-xs text-slate-600">
                          {r.status}
                        </TableCell>
                        <TableCell className="max-w-sm truncate text-xs text-slate-500">
                          {r.notes ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          <Link
                            href={{ pathname: `/banking/receipts/${r.id}` }}
                            className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                          >
                            {formatMoney(r.total)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
