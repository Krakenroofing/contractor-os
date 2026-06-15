import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { listInvoices } from '@/lib/data/invoices';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import {
  BulkCategorizeRevenueClient,
  type RevenueInvoiceRow,
} from '@/modules/invoices/components/bulk-categorize-revenue-client';

export const dynamic = 'force-dynamic';

export default async function CategorizeRevenuePage() {
  const role = await getActiveRole();
  if (!canView(role, 'invoices')) redirect('/dashboard');
  const company = await getActiveCompany();

  const [invoices, projects, customers, accounts] = await Promise.all([
    listInvoices(company.id),
    listProjects(company.id),
    listCustomers(company.id),
    listAccountingAccounts(company.id),
  ]);

  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const projMap = new Map(
    projects.map((p) => [
      p.id,
      { name: p.name, customerName: customerName.get(p.customerId) ?? 'Unknown' },
    ]),
  );

  const rows: RevenueInvoiceRow[] = invoices
    .filter((i) => i.status !== 'void')
    .map((i) => {
      const pm = projMap.get(i.projectId);
      return {
        id: i.id,
        number: i.number,
        date: String(i.invoiceDate),
        projectId: i.projectId,
        projectName: pm?.name ?? 'Unknown project',
        customerName: pm?.customerName ?? '',
        amount: Number(i.subtotal),
        status: i.status,
        categoryId: i.accountingAccountId ?? null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const projectIdsWithInvoices = new Set(rows.map((r) => r.projectId));
  const projectOptions = projects
    .filter((p) => projectIdsWithInvoices.has(p.id))
    .map((p) => ({ id: p.id, label: p.name }));

  const incomeAccounts = toAccountingAccountOptions(
    accounts.filter((a) => a.rollupGroup === 'income'),
  );
  const canEdit = canCreate(role, 'invoices');

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link
          href={{ pathname: '/reports/profit-loss' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to P&amp;L
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          Categorize revenue
        </h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Assign a revenue category (service line) to invoices in bulk. Filter
          to a project, select its invoices, and stamp the category — the P&amp;L
          income line then splits by service type. Tip: each job is usually one
          service type, so filtering by project makes this fast.
        </p>
      </div>

      <BulkCategorizeRevenueClient
        invoices={rows}
        projects={projectOptions}
        incomeAccounts={incomeAccounts}
        canEdit={canEdit}
      />
    </div>
  );
}
