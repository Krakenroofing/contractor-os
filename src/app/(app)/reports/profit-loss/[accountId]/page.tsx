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

  // "Who makes up this number" — one row per payee × job, so a category like
  // Subcontractors reads as a list of names and the jobs they worked instead
  // of a pile of transactions to add up by hand. Grouped by vendor id where
  // there is one, so two spellings of the same supplier still collapse.
  const payeeGroups = new Map<
    string,
    {
      payeeName: string;
      vendorId: string | null;
      employeeId: string | null;
      projectId: string | null;
      projectName: string | null;
      count: number;
      amount: number;
    }
  >();
  for (const e of entries) {
    const payeeName = e.payeeName ?? '—';
    const key = `${e.vendorId ?? payeeName.toLowerCase()}|${e.projectId ?? ''}`;
    const cur = payeeGroups.get(key) ?? {
      payeeName,
      vendorId: e.vendorId ?? null,
      employeeId: e.employeeId ?? null,
      projectId: e.projectId ?? null,
      projectName: e.projectName ?? null,
      count: 0,
      amount: 0,
    };
    cur.employeeId = cur.employeeId ?? e.employeeId ?? null;
    cur.count += 1;
    cur.amount = Math.round((cur.amount + e.amount) * 100) / 100;
    payeeGroups.set(key, cur);
  }
  const payeeRows = Array.from(payeeGroups.values()).sort(
    (a, b) => b.amount - a.amount,
  );

  // Payroll rows belong to a person, not a week. Point them at that person's
  // payroll summary over the SAME range the drill is showing, so one click
  // gives pay + NIB withheld for every week in the period, in one place.
  // Falls back to the pay-period sheet when the row has no single owner.
  const payrollHref = (
    employeeId: string | null | undefined,
    weekStart: string | undefined,
  ): string | null => {
    if (employeeId) {
      const q = new URLSearchParams({ employeeId });
      if (filters.from) q.set('from', filters.from);
      if (filters.to) q.set('to', filters.to);
      return `/reports/payroll-summary?${q.toString()}`;
    }
    return weekStart ? `/payroll?week=${weekStart}` : null;
  };

  const backHref = {
    pathname: '/reports/profit-loss' as const,
    query: {
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
    },
  };

  return (
    // Full page width, not a 4xl column: the entries table has six fixed-width
    // columns, so a narrow container squeezed Description into a 3-word ribbon
    // while two thirds of the screen sat empty.
    <div className="p-6 space-y-6 max-w-[1600px]">
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

      {payeeRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Who this is — {payeeRows.length}{' '}
              {payeeRows.length === 1 ? 'payee' : 'payees'} &amp; jobs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-56">Job</TableHead>
                  <TableHead className="text-right w-24">Entries</TableHead>
                  <TableHead className="text-right w-32">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payeeRows.map((p, i) => (
                  <TableRow key={`${p.payeeName}-${p.projectId ?? ''}-${i}`}>
                    <TableCell className="text-slate-900">
                      {p.vendorId ? (
                        <Link
                          href={`/vendors/${p.vendorId}`}
                          className="text-blue-700 hover:underline"
                          title="View this supplier"
                        >
                          {p.payeeName}
                        </Link>
                      ) : p.employeeId ? (
                        <Link
                          href={payrollHref(p.employeeId, undefined) as never}
                          className="text-blue-700 hover:underline"
                          title="See this person's pay and NIB for every week in this range"
                        >
                          {p.payeeName}
                        </Link>
                      ) : (
                        p.payeeName
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {p.projectId && p.projectName ? (
                        <Link
                          href={`/projects/${p.projectId}` as never}
                          className="text-blue-700 hover:underline"
                          title="Open this job"
                        >
                          {p.projectName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">Not job-costed</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {p.count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(p.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-200">
                  <TableCell colSpan={3} className="font-semibold text-slate-900">
                    Total
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
                  <TableHead className="w-44">Job</TableHead>
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
                    <TableCell className="tabular-nums text-slate-700 whitespace-nowrap">
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
                      ) : payrollHref(e.employeeId, e.payrollWeekStart) ? (
                        <Link
                          href={
                            payrollHref(
                              e.employeeId,
                              e.payrollWeekStart,
                            ) as never
                          }
                          className="text-blue-700 hover:underline"
                          title={
                            e.employeeId
                              ? "See this person's pay and NIB for every week in this range"
                              : 'Open this pay period on the payroll page'
                          }
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
                    <TableCell className="text-slate-600">
                      {e.projectId && e.projectName ? (
                        <Link
                          href={`/projects/${e.projectId}` as never}
                          className="hover:underline underline-offset-2"
                          title="Open this job"
                        >
                          {e.projectName}
                        </Link>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
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
                      ) : payrollHref(e.employeeId, e.payrollWeekStart) ? (
                        <Link
                          href={
                            payrollHref(
                              e.employeeId,
                              e.payrollWeekStart,
                            ) as never
                          }
                          target="_blank"
                          className="text-blue-700 hover:underline"
                          title={
                            e.employeeId
                              ? "See this person's pay and NIB for every week in this range"
                              : 'Open this pay period on the payroll page'
                          }
                        >
                          {formatMoney(e.amount)}
                        </Link>
                      ) : e.projectId ? (
                        <Link
                          href={`/projects/${e.projectId}` as never}
                          target="_blank"
                          className="text-blue-700 hover:underline"
                          title="Open the project this cost is on"
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
                    colSpan={(canRecategorize ? 6 : 5) + (includeSubs ? 1 : 0)}
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
