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
import { listProfitLossRevenueEntries } from '@/lib/data/profit-loss';
import { parseReportFilters, describeRange } from '@/modules/reports/lib/filters';

export const dynamic = 'force-dynamic';

// Revenue drill-down: the individual invoices behind the P&L "Income" total
// (or one revenue category). Same date filter as the statement, so the list
// ties to the number on the report — for month-to-month reconciliation.
export default async function ProfitLossRevenueDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const filters = parseReportFilters(sp);
  const account = typeof sp.account === 'string' ? sp.account : undefined;

  const detail = await listProfitLossRevenueEntries(
    company.id,
    filters,
    account,
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
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link
          href={backHref}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Profit &amp; Loss
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          {detail.scopeLabel}
        </h1>
        <p className="text-sm text-slate-500">
          {describeRange(filters)} · {detail.entries.length} invoice
          {detail.entries.length === 1 ? '' : 's'} ·{' '}
          <span className="font-medium text-slate-900">
            {formatMoney(detail.total)}
          </span>{' '}
          (ex-VAT)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {detail.entries.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No invoices in this date range (excluding draft + void).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-28">Invoice</TableHead>
                  <TableHead>Customer / Project</TableHead>
                  <TableHead>Revenue category</TableHead>
                  <TableHead className="text-right w-32">Ex-VAT</TableHead>
                  <TableHead className="text-right w-32">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.entries.map((e) => (
                  <TableRow key={e.invoiceId}>
                    <TableCell className="tabular-nums text-slate-700">
                      {e.date}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/invoices/${e.invoiceId}`}
                        target="_blank"
                        className="text-blue-700 hover:underline"
                      >
                        {e.number || '—'} ↗
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-900">
                      <span className="block">{e.customerName}</span>
                      <span className="block text-xs text-slate-500">
                        {e.projectName}
                      </span>
                    </TableCell>
                    <TableCell
                      className={
                        e.categoryName ? 'text-slate-700' : 'text-amber-700'
                      }
                    >
                      {e.categoryName ?? 'Uncategorized'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(e.subtotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">
                      {formatMoney(e.total)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-200">
                  <TableCell colSpan={4} className="font-semibold text-slate-900">
                    Total (ex-VAT)
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(detail.total)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
