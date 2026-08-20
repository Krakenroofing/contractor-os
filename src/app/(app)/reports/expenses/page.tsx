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
import { Button } from '@/components/ui/button';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listPaymentMethods } from '@/lib/data/payment-methods';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import {
  buildExpenseReport,
  type ExpenseReportFilters,
} from '@/lib/data/expense-report';

export const dynamic = 'force-dynamic';

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}
function many(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter(Boolean);
}

export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) {
    redirect('/dashboard');
  }
  const company = await getActiveCompany();
  const params = await searchParams;

  const filters: ExpenseReportFilters = {
    from: first(params.from) || undefined,
    to: first(params.to) || undefined,
    bankAccountId: first(params.account) || undefined,
    categoryIds: many(params.category),
    projectId: first(params.project) || undefined,
    vendorId: first(params.vendor) || undefined,
    paymentMethodId: first(params.method) || undefined,
  };

  const [report, accounts, categories, projects, vendors, methods] =
    await Promise.all([
      buildExpenseReport(company.id, filters),
      listBankAccounts(company.id),
      listAccountingAccounts(company.id),
      listProjects(company.id),
      listVendors(company.id),
      listPaymentMethods(company.id),
    ]);

  // Categories shown in the filter: postable COGS/OpEx leaves, tree-ordered
  // isn't needed here — alphabetical within group.
  const expenseCategories = categories
    .filter(
      (a) =>
        !a.isArchived &&
        (a.rollupGroup === 'cogs' || a.rollupGroup === 'opex') &&
        a.parentId !== null,
    )
    .sort(
      (a, b) =>
        a.rollupGroup.localeCompare(b.rollupGroup) ||
        a.name.localeCompare(b.name),
    );

  const activeFilterCount = [
    filters.bankAccountId,
    filters.projectId,
    filters.vendorId,
    filters.paymentMethodId,
  ].filter(Boolean).length + (filters.categoryIds?.length ? 1 : 0);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">
            Expense report
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every operational expense line — bank &amp; card transactions,
            split lines, posted receipts, and payment fees — for{' '}
            <span className="font-medium text-slate-900">{company.name}</span>.
            Payroll lives on its own reports.
          </p>
        </header>
        <Link href={{ pathname: '/reports' }}>
          <Button variant="outline" size="sm">
            ← All reports
          </Button>
        </Link>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* ===== Results (left) ===== */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Total expenses
              </p>
              <p className="text-lg font-semibold text-slate-900 tabular-nums">
                {formatMoney(report.total)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Lines
              </p>
              <p className="text-lg font-semibold text-slate-900 tabular-nums">
                {report.rowCount}
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {report.rows.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  No expenses match{' '}
                  {activeFilterCount > 0 || filters.from || filters.to
                    ? 'these filters.'
                    : '— categorize some transactions or post receipts first.'}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {r.date}
                        </TableCell>
                        <TableCell className="max-w-[16rem]">
                          <a
                            href={r.href}
                            className="block truncate text-slate-900 underline-offset-2 hover:underline"
                            title={r.description}
                          >
                            {r.description}
                          </a>
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate text-xs text-slate-600">
                          {r.vendorName ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {r.categoryName}
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate text-xs text-slate-600">
                          {r.projectName ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {r.accountName}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {r.paymentMethodName ?? '—'}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-medium ${
                            r.amount < 0 ? 'text-emerald-700' : ''
                          }`}
                        >
                          {r.amount < 0
                            ? `(${formatMoney(-r.amount)})`
                            : formatMoney(r.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {report.truncated && (
            <p className="text-xs text-amber-700">
              Showing the {report.rows.length} most recent lines of{' '}
              {report.rowCount} — narrow the date range or filters to see the
              rest. The total covers all matching lines.
            </p>
          )}
        </div>

        {/* ===== Filters (right) ===== */}
        <form
          method="get"
          className="w-full shrink-0 lg:w-72 print:hidden"
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-slate-600">
                  From
                  <input
                    type="date"
                    name="from"
                    defaultValue={filters.from ?? ''}
                    className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-xs"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  To
                  <input
                    type="date"
                    name="to"
                    defaultValue={filters.to ?? ''}
                    className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-xs"
                  />
                </label>
              </div>

              <label className="block text-xs text-slate-600">
                Account
                <select
                  name="account"
                  defaultValue={filters.bankAccountId ?? ''}
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                >
                  <option value="">All accounts</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} {a.type === 'credit_card' ? '(CC)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-600">
                Job
                <select
                  name="project"
                  defaultValue={filters.projectId ?? ''}
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                >
                  <option value="">All jobs</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-600">
                Vendor
                <select
                  name="vendor"
                  defaultValue={filters.vendorId ?? ''}
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                >
                  <option value="">All vendors</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-600">
                Payment method
                <select
                  name="method"
                  defaultValue={filters.paymentMethodId ?? ''}
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                >
                  <option value="">All methods</option>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="text-xs text-slate-600">
                <legend className="mb-1">
                  Categories{' '}
                  <span className="text-slate-400">(pick any)</span>
                </legend>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                  {expenseCategories.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        name="category"
                        value={c.id}
                        defaultChecked={filters.categoryIds?.includes(c.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto text-[10px] uppercase text-slate-400">
                        {c.rollupGroup}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex items-center gap-2">
                <Button type="submit" size="sm">
                  Apply
                </Button>
                <Link
                  href={{ pathname: '/reports/expenses' }}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  Clear
                </Link>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
