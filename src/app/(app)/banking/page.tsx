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
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import {
  listImportBatches,
} from '@/lib/data/statement-imports';
import { BANK_ACCOUNT_TYPE_LABEL } from '@/modules/banking/schema';
import { DeleteImportBatchButton } from '@/modules/banking/components/delete-import-batch-button';

export const dynamic = 'force-dynamic';

export default async function BankingHome() {
  const role = await getActiveRole();
  if (!canView(role, 'bank_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const [accounts, batches] = await Promise.all([
    listBankAccounts(company.id),
    listImportBatches(company.id, { limit: 20 }),
  ]);
  const canCreateBank = canCreate(role, 'bank_accounts');
  const canImport = canCreate(role, 'statement_imports');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Banking &amp; Receipts
          </h1>
          <p className="text-sm text-slate-500">
            Bank and credit-card accounts, statement imports, and (later)
            receipts. Phase 1: import-only — no posting, no matching.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={{ pathname: '/banking/reimbursements' }}>
            <Button variant="outline">Reimbursements</Button>
          </Link>
          <Link href={{ pathname: '/banking/receipts' }}>
            <Button variant="outline">Receipts</Button>
          </Link>
          <Link href={{ pathname: '/banking/rules' }}>
            <Button variant="outline">Rules</Button>
          </Link>
          <Link href={{ pathname: '/banking/reconcile' }}>
            <Button variant="outline">Reconcile</Button>
          </Link>
          {canCreateBank && (
            <Link href={{ pathname: '/banking/accounts/new' }}>
              <Button variant="outline">Add account</Button>
            </Link>
          )}
          {canImport && accounts.length > 0 && (
            <Link href={{ pathname: '/banking/import' }}>
              <Button>Import statement</Button>
            </Link>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {accounts.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-600">
                No bank accounts yet. Add one to start importing statements.
              </p>
              {canCreateBank && (
                <Link href={{ pathname: '/banking/accounts/new' }}>
                  <Button>Add your first account</Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Last 4</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Opening balance</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={{ pathname: `/banking/accounts/${a.id}` }}
                        className="hover:underline"
                      >
                        {a.name}
                      </Link>
                    </TableCell>
                    <TableCell>{BANK_ACCOUNT_TYPE_LABEL[a.type]}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {a.last4 ?? '—'}
                    </TableCell>
                    <TableCell>{a.currency}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(a.openingBalance, a.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={{ pathname: `/banking/accounts/${a.id}` }}
                        className="text-xs underline text-slate-600 hover:text-slate-900"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {batches.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No imports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Duplicates</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead>Uploaded</TableHead>
                  {canImport && <TableHead className="text-right"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      <Link
                        href={{ pathname: `/banking/import/${b.id}` }}
                        className="hover:underline"
                      >
                        {b.sourceFilename}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{b.status}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.rowCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {b.importedCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">
                      {b.duplicateCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">
                      {b.errorCount}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {b.createdAt.toISOString().slice(0, 10)}
                    </TableCell>
                    {canImport && (
                      <TableCell className="text-right">
                        <DeleteImportBatchButton
                          batchId={b.id}
                          filename={b.sourceFilename}
                          rowCount={b.rowCount}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
