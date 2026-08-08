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
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import {
  getLastCompletedBankReconciliation,
  getOpenBankReconciliation,
  listBankReconciliations,
} from '@/lib/data/bank-reconciliations';
import {
  StartReconcileForm,
  type ReconcileAccountOption,
} from '@/modules/banking/components/start-reconcile-form';
import { ReopenReconciliationButton } from '@/modules/banking/components/reconcile-history-actions';

export const dynamic = 'force-dynamic';

export default async function BankReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'bank_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const justFinished = sp.finished === '1';
  const canReconcile = canCreate(role, 'statement_imports');

  const accounts = (await listBankAccounts(company.id)).filter(
    (a) => !a.archivedAt,
  );
  const options: ReconcileAccountOption[] = await Promise.all(
    accounts.map(async (a) => {
      const [last, open] = await Promise.all([
        getLastCompletedBankReconciliation(company.id, a.id),
        getOpenBankReconciliation(company.id, a.id),
      ]);
      return {
        id: a.id,
        name: a.name,
        last4: a.last4,
        currency: a.currency,
        // Next period's beginning = last completed ending, else the account's
        // opening balance.
        beginningBalance: last
          ? Number(last.endingBalance)
          : Number(a.openingBalance),
        lastStatementDate: last?.statementDate ?? null,
        openReconciliationId: open?.id ?? null,
      };
    }),
  );

  const history = await listBankReconciliations(company.id);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

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
          Bank reconciliation
        </h1>
        <p className="text-sm text-slate-500">
          Match a bank statement to the book: beginning balance + deposits −
          payments must equal the statement ending balance. Complete this after
          importing each month&apos;s statement.
        </p>
      </div>

      {justFinished && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Reconciliation completed — the account ties to the statement. 🎉
        </div>
      )}

      {canReconcile ? (
        <Card>
          <CardHeader>
            <CardTitle>Which account do you want to reconcile?</CardTitle>
          </CardHeader>
          <CardContent>
            <StartReconcileForm accounts={options} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-slate-500">
          You have read-only access — reconciliation history is below.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {history.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No reconciliations yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Statement date</TableHead>
                  <TableHead className="text-right">Beginning</TableHead>
                  <TableHead className="text-right">Ending</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => {
                  const account = accountById.get(r.bankAccountId);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {account?.name ?? '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <Link
                          href={{ pathname: `/banking/reconcile/${r.id}` }}
                          className="hover:underline"
                        >
                          {r.statementDate}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.beginningBalance, account?.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.endingBalance, account?.currency)}
                      </TableCell>
                      <TableCell>
                        {r.status === 'completed' ? (
                          <span className="text-emerald-700">Completed</span>
                        ) : (
                          <span className="text-amber-700">In progress</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {r.completedAt
                          ? r.completedAt.toISOString().slice(0, 10)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {canReconcile && r.status === 'completed' ? (
                          <ReopenReconciliationButton
                            reconciliationId={r.id}
                            label={r.statementDate}
                          />
                        ) : canReconcile ? (
                          <Link href={{ pathname: `/banking/reconcile/${r.id}` }}>
                            <span className="text-xs underline text-slate-600 hover:text-slate-900">
                              Resume
                            </span>
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
