import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { getBankAccount } from '@/lib/data/bank-accounts';
import {
  listImportedTransactions,
  listLinesForTransactionIds,
} from '@/lib/data/statement-imports';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listVendors } from '@/lib/data/vendors';
import { listCustomers } from '@/lib/data/customers';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import { BulkCategorizeClient } from '@/modules/banking/components/bulk-categorize-client';

export const dynamic = 'force-dynamic';

export default async function BulkCategorizePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'bank_accounts')) redirect('/dashboard' as never);
  const company = await getActiveCompany();
  const { id } = await params;
  const account = await getBankAccount(company.id, id);
  if (!account) notFound();

  const [txns, accounts, projects, costCodes, vendors, customers] =
    await Promise.all([
      listImportedTransactions(company.id, {
        bankAccountId: account.id,
        onlyUncategorized: true,
        onlyUnreviewed: true,
        includeIgnored: false,
        limit: 500,
      }),
      listAccountingAccounts(company.id),
      listProjects(company.id),
      listCostCodes(company.id),
      listVendors(company.id),
      listCustomers(company.id),
    ]);

  // Drop split rows — their per-line categories are the source of truth, so a
  // bulk parent-level assign would be wrong. (They show as uncategorized
  // because the parent fields are null while lines carry the detail.)
  const lines = await listLinesForTransactionIds(
    company.id,
    txns.map((t) => t.id),
  );
  const splitIds = new Set(lines.map((l) => l.importedTransactionId));
  const transactions = txns
    .filter((t) => !splitIds.has(t.id))
    .map((t) => ({
      id: t.id,
      date: String(t.transactionDate),
      description: t.description,
      payee: t.payee,
      amount: Number(t.amount),
      currency: t.currency,
    }));

  const categories = toAccountingAccountOptions(
    accounts.filter((a) => a.type !== 'bank' && a.type !== 'credit_card'),
  );
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const customerOptions = customers.map((c) => ({ id: c.id, name: c.name }));
  const costCodeOptions = costCodes.map((c) => ({
    id: c.id,
    label: `${c.code} — ${c.description}`,
  }));
  const vendorOptions = vendors.map((v) => ({ id: v.id, name: v.name }));

  const canEdit = canCreate(role, 'statement_imports');

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link
          href={{ pathname: `/banking/accounts/${account.id}` }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to {account.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          Categorize to jobs
        </h1>
        <p className="text-sm text-slate-500">
          Tick the transactions for a job, then assign a project + category in
          one go. Assigned spend flows into job costs and the WIP report.
        </p>
      </div>

      <BulkCategorizeClient
        bankAccountId={account.id}
        transactions={transactions}
        categories={categories}
        projects={projectOptions}
        customers={customerOptions}
        costCodes={costCodeOptions}
        vendors={vendorOptions}
        canEdit={canEdit}
      />
    </div>
  );
}
