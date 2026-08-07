import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listProfitLossRevenueEntries } from '@/lib/data/profit-loss';
import { parseReportFilters, describeRange } from '@/modules/reports/lib/filters';
import { exTaxLabel } from '@/modules/reports/lib/tax-label';
import { RevenueTable } from './revenue-table';

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
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const exTax = exTaxLabel(company.isVatActive);
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
          {describeRange(filters)} · {detail.entries.length} row
          {detail.entries.length === 1 ? '' : 's'} ·{' '}
          <span className="font-medium text-slate-900">
            {formatMoney(detail.total)}
          </span>{' '}
          ({exTax})
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices &amp; credit memos</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {detail.entries.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No invoices in this date range (excluding draft + void).
            </p>
          ) : (
            <RevenueTable
              entries={detail.entries}
              exTax={exTax}
              total={detail.total}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
