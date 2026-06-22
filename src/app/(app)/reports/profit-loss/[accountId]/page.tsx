import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
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
import { listProfitLossAccountEntries } from '@/lib/data/profit-loss';
import { parseReportFilters, describeRange } from '@/modules/reports/lib/filters';

export const dynamic = 'force-dynamic';

const GROUP_LABEL: Record<string, string> = {
  income: 'Income',
  cogs: 'Cost of Goods Sold',
  opex: 'Operating Expense',
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  vat_tax: 'VAT / Tax',
};

export default async function ProfitLossAccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const { accountId } = await params;
  const sp = await searchParams;
  const filters = parseReportFilters(sp);

  const detail = await listProfitLossAccountEntries(
    company.id,
    accountId,
    filters,
  );
  if (!detail) notFound();

  const backHref = {
    pathname: '/reports/profit-loss' as const,
    query: {
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
    },
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link
          href={backHref}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Profit &amp; Loss
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          {detail.accountName}
        </h1>
        <p className="text-sm text-slate-500">
          {GROUP_LABEL[detail.rollupGroup] ?? detail.rollupGroup} ·{' '}
          {describeRange(filters)} · {detail.entries.length} entr
          {detail.entries.length === 1 ? 'y' : 'ies'} ·{' '}
          <span className="font-medium text-slate-900">
            {formatMoney(detail.total)}
          </span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {detail.entries.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No entries for this category in the selected range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-36">Source</TableHead>
                  <TableHead className="text-right w-32">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.entries.map((e, i) => (
                  <TableRow key={`${e.date}-${i}`}>
                    <TableCell className="tabular-nums text-slate-700">
                      {e.date}
                    </TableCell>
                    <TableCell className="text-slate-900">
                      {e.importedTransactionId ? (
                        <Link
                          href={`/banking/transactions/${e.importedTransactionId}`}
                          target="_blank"
                          className="text-blue-700 hover:underline"
                        >
                          {e.description || '—'}
                        </Link>
                      ) : (
                        e.description || '—'
                      )}
                    </TableCell>
                    <TableCell className="text-slate-500">
                      {e.importedTransactionId ? (
                        <Link
                          href={`/banking/transactions/${e.importedTransactionId}`}
                          target="_blank"
                          className="text-blue-700 hover:underline"
                        >
                          {e.source} ↗
                        </Link>
                      ) : (
                        e.source
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(e.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-200">
                  <TableCell colSpan={3} className="font-semibold text-slate-900">
                    Total
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(detail.total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
