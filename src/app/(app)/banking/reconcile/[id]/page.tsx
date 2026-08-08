import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getBankAccount } from '@/lib/data/bank-accounts';
import {
  getBankReconciliation,
  listReconciliationCandidates,
} from '@/lib/data/bank-reconciliations';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import {
  ReconcileWorkspace,
  type ReconcileTxnRow,
} from '@/modules/banking/components/reconcile-workspace';

export const dynamic = 'force-dynamic';

export default async function BankReconcileWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'bank_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const { id } = await params;

  const rec = await getBankReconciliation(company.id, id);
  if (!rec) notFound();
  const account = await getBankAccount(company.id, rec.bankAccountId);
  if (!account) notFound();

  const [txns, categories] = await Promise.all([
    listReconciliationCandidates(
      company.id,
      rec.bankAccountId,
      rec.id,
      rec.statementDate,
    ),
    listAccountingAccounts(company.id),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c.name]));

  const rows: ReconcileTxnRow[] = txns.map((t) => ({
    id: t.id,
    date: t.transactionDate,
    description: t.description,
    payee: t.payee,
    reference: t.reference,
    categoryName: t.accountingAccountId
      ? (categoryById.get(t.accountingAccountId) ?? null)
      : null,
    amount: Number(t.amount),
    cleared: t.bankReconciliationId === rec.id,
  }));

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link
          href={{ pathname: '/banking/reconcile' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Bank reconciliation
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Reconcile — {account.name}
          {account.last4 ? ` ····${account.last4}` : ''}
        </h1>
        <p className="text-sm text-slate-500">
          Statement ending {rec.statementDate}
          {rec.status === 'completed'
            ? ' · Completed — read-only (reopen from the history list to change it)'
            : ' · Uncheck anything that is NOT on the bank statement; the difference must reach 0.00.'}
        </p>
      </div>

      <ReconcileWorkspace
        reconciliationId={rec.id}
        accountName={account.name}
        currency={account.currency}
        statementDate={rec.statementDate}
        beginningBalance={Number(rec.beginningBalance)}
        endingBalance={Number(rec.endingBalance)}
        completed={rec.status === 'completed'}
        rows={rows}
      />
    </div>
  );
}
