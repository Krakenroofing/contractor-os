import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
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
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listImportBatches } from '@/lib/data/statement-imports';

export const dynamic = 'force-dynamic';

// Original uploaded bank statements, unmodified — the audit trail. Every
// import batch keeps its source file byte-for-byte in private storage; this
// page lists them per account with a download link (QB's "View statements").
export default async function BankStatementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'statement_imports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const sp = await searchParams;
  const accountFilter = typeof sp.account === 'string' ? sp.account : '';

  const [accounts, batches] = await Promise.all([
    listBankAccounts(company.id),
    listImportBatches(company.id, {
      bankAccountId: accountFilter || undefined,
      limit: 200,
    }),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link
          href={{ pathname: '/banking/reconcile' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Bank reconciliation
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Bank statements
        </h1>
        <p className="text-sm text-slate-500">
          The original uploaded statement files, exactly as they came from the
          bank — nothing the app does ever modifies them. Download for
          auditors or to re-check an import.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Account:</span>
        <FilterChip href="/banking/statements" active={accountFilter === ''}>
          All
        </FilterChip>
        {accounts.map((a) => (
          <FilterChip
            key={a.id}
            href={`/banking/statements?account=${a.id}`}
            active={accountFilter === a.id}
          >
            {a.name}
          </FilterChip>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Uploaded statements
            {accountFilter
              ? ` — ${accountById.get(accountFilter)?.name ?? ''}`
              : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {batches.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No statements uploaded yet
              {accountFilter ? ' for this account' : ''}.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => {
                  const isManual = b.storagePath === 'manual';
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs text-slate-700 max-w-sm truncate">
                        {b.sourceFilename}
                        {isManual && (
                          <span className="ml-2">
                            <Badge tone="slate">no file</Badge>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {accountById.get(b.bankAccountId)?.name ?? '—'}
                      </TableCell>
                      <TableCell className="capitalize text-xs text-slate-600">
                        {b.status}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.rowCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {b.importedCount}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {b.createdAt.toISOString().slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isManual ? (
                          <span className="text-xs text-slate-400">
                            manual entries
                          </span>
                        ) : (
                          <a
                            href={`/banking/statements/${b.id}/download`}
                            className="text-xs font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
                          >
                            Download original
                          </a>
                        )}
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

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={{ pathname: href.split('?')[0], query: parseQuery(href) }}
      className={`rounded-full border px-3 py-1 ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </Link>
  );
}

function parseQuery(href: string): Record<string, string> {
  const q = href.split('?')[1];
  if (!q) return {};
  return Object.fromEntries(new URLSearchParams(q).entries());
}
