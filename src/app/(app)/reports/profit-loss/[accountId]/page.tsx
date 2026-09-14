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
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import { parseReportFilters, describeRange } from '@/modules/reports/lib/filters';
import { RecategorizeCell } from './recategorize-cell';

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
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const { accountId } = await params;
  const sp = await searchParams;
  const filters = parseReportFilters(sp);
  // ?subs=1 (the P&L's "Total parent" rows): include the parent's
  // subaccounts so the drill matches books that track only the total
  // (QB with no subcategories).
  const includeSubs = sp.subs === '1';

  const allAccounts = await listAccountingAccounts(company.id);
  const detail = await listProfitLossAccountEntries(
    company.id,
    accountId,
    filters,
  );
  if (!detail) notFound();

  const subAccounts = includeSubs
    ? allAccounts.filter((a) => a.parentId === accountId)
    : [];
  const subDetails = (
    await Promise.all(
      subAccounts.map((a) =>
        listProfitLossAccountEntries(company.id, a.id, filters),
      ),
    )
  ).filter((d): d is NonNullable<typeof d> => d !== null);

  // One flat list; in combined mode each entry remembers which category it
  // came from (rendered as a column, and re-categorization targets it).
  const allDetails = [detail, ...subDetails];
  const entries = allDetails
    .flatMap((d) =>
      d.entries.map((e) => ({
        ...e,
        entryAccountId: d.accountId,
        entryAccountName: d.accountName,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = allDetails.reduce((s, d) => s + d.total, 0);
  const title = includeSubs ? `Total ${detail.accountName}` : detail.accountName;

  // Category options for inline re-categorization of job-cost (expense) rows.
  const accountOptions = toAccountingAccountOptions(allAccounts);
  const canRecategorize = entries.some((e) => e.jobCostEntryId);

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
          {title}
        </h1>
        <p className="text-sm text-slate-500">
          {GROUP_LABEL[detail.rollupGroup] ?? detail.rollupGroup} ·{' '}
          {includeSubs &&
            `${detail.accountName} + ${subAccounts.length} subcategor${
              subAccounts.length === 1 ? 'y' : 'ies'
            } · `}
          {describeRange(filters)} · {entries.length} entr
          {entries.length === 1 ? 'y' : 'ies'} ·{' '}
          <span className="font-medium text-slate-900">
            {formatMoney(total)}
          </span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {entries.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No entries for this category in the selected range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Description</TableHead>
                  {includeSubs && (
                    <TableHead className="w-40">Category</TableHead>
                  )}
                  <TableHead className="w-36">Source</TableHead>
                  <TableHead className="w-44">Account</TableHead>
                  {canRecategorize && (
                    <TableHead className="w-64">Re-categorize</TableHead>
                  )}
                  <TableHead className="text-right w-32">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => (
                  <TableRow key={`${e.date}-${i}`}>
                    <TableCell className="tabular-nums text-slate-700">
                      {e.date}
                    </TableCell>
                    <TableCell className="text-slate-900">
                      {e.vendorId ? (
                        <Link
                          href={`/vendors/${e.vendorId}`}
                          className="text-blue-700 hover:underline"
                          title="View this supplier"
                        >
                          {e.description || '—'}
                        </Link>
                      ) : (
                        e.description || '—'
                      )}
                    </TableCell>
                    {includeSubs && (
                      <TableCell className="text-slate-600">
                        {e.entryAccountName}
                      </TableCell>
                    )}
                    <TableCell className="text-slate-500">{e.source}</TableCell>
                    <TableCell className="text-slate-600">
                      {e.accountLabel && e.bankAccountId ? (
                        <Link
                          href={
                            `/banking/accounts/${e.bankAccountId}` as never
                          }
                          className="underline-offset-2 hover:underline"
                          title="Open this account's register"
                        >
                          {e.accountLabel}
                        </Link>
                      ) : (
                        (e.accountLabel ?? <span className="text-slate-300">—</span>)
                      )}
                    </TableCell>
                    {canRecategorize && (
                      <TableCell>
                        {e.jobCostEntryId ? (
                          <RecategorizeCell
                            entryId={e.jobCostEntryId}
                            currentAccountId={e.entryAccountId}
                            accounts={accountOptions}
                          />

                        ) : (
                          <span className="text-xs text-slate-400">
                            {e.source === 'Payroll'
                              ? 'from payroll'
                              : 'edit on transaction ↗'}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums font-medium">
                      {e.importedTransactionId ? (
                        <Link
                          href={
                            (e.bankAccountId
                              ? `/banking/accounts/${e.bankAccountId}?txn=${e.importedTransactionId}`
                              : `/banking/transactions/${e.importedTransactionId}`) as never
                          }
                          target="_blank"
                          className="text-blue-700 hover:underline"
                          title="Open in the register to edit"
                        >
                          {formatMoney(e.amount)}
                        </Link>
                      ) : e.receiptId ? (
                        <Link
                          href={`/banking/receipts/${e.receiptId}`}
                          target="_blank"
                          className="text-blue-700 hover:underline"
                          title="View this receipt"
                        >
                          {formatMoney(e.amount)}
                        </Link>
                      ) : e.journalEntryId ? (
                        <Link
                          href={
                            `/accounting/journal?entry=${e.journalEntryId}` as never
                          }
                          target="_blank"
                          className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                          title="View this journal entry"
                        >
                          {formatMoney(e.amount)}
                        </Link>
                      ) : (
                        formatMoney(e.amount)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-200">
                  <TableCell
                    colSpan={(canRecategorize ? 5 : 4) + (includeSubs ? 1 : 0)}
                    className="font-semibold text-slate-900"
                  >
                    Total
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(total)}
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
