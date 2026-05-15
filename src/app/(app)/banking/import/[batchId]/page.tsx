import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getImportBatch,
  listMappingsForAccount,
} from '@/lib/data/statement-imports';
import { getBankAccount } from '@/lib/data/bank-accounts';
import { downloadStatementBytes } from '@/lib/storage/statement-files';
import { parseStatementBytes } from '@/modules/banking/lib/parse';
import { MappingWizard } from '@/modules/banking/components/mapping-wizard';
import type {
  AmountStrategy,
  ColumnMap,
  DateFormat,
} from '@/modules/banking/lib/mapping';

export const dynamic = 'force-dynamic';

export default async function MappingPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'statement_imports')) redirect('/banking' as never);
  const company = await getActiveCompany();
  const { batchId } = await params;
  const batch = await getImportBatch(company.id, batchId);
  if (!batch) notFound();
  const account = await getBankAccount(company.id, batch.bankAccountId);
  if (!account) notFound();

  // If the batch is already imported, redirect back to the account.
  if (batch.status === 'imported') {
    redirect(`/banking/accounts/${account.id}` as never);
  }

  // Pull the file, parse it, and grab the first 200 rows for the preview.
  const bytes = await downloadStatementBytes(batch.storagePath);
  if (!bytes) {
    return (
      <div className="p-6 space-y-4">
        <Link
          href={{ pathname: '/banking' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Banking
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Import unavailable</h1>
        <p className="text-sm text-red-600">
          Could not load the original file from storage. Re-upload the
          statement to continue.
        </p>
      </div>
    );
  }
  const parsed = await parseStatementBytes({
    bytes,
    mimeType: batch.mimeType,
    filename: batch.sourceFilename,
  });

  // Look up any saved mapping for this account so the wizard preselects it.
  const mappings = await listMappingsForAccount(company.id, account.id);
  const preferred = mappings[0];
  const initial = preferred
    ? {
        label: preferred.label,
        columnMap: (preferred.columnMap as ColumnMap) ?? ({} as ColumnMap),
        dateFormat: preferred.dateFormat as DateFormat,
        amountStrategy: preferred.amountStrategy as AmountStrategy,
        decimalSeparator: preferred.decimalSeparator,
        thousandsSeparator: preferred.thousandsSeparator,
        skipRows: preferred.skipRows,
      }
    : undefined;

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={{ pathname: '/banking' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Banking
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Map columns
        </h1>
        <p className="text-sm text-slate-500">
          {account.name} · {batch.sourceFilename} · {parsed.rows.length} row(s)
          in file
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Mapping &amp; preview</CardTitle>
        </CardHeader>
        <CardContent>
          <MappingWizard
            batchId={batch.id}
            filename={batch.sourceFilename}
            headers={parsed.headers}
            sampleRows={parsed.rows.slice(0, 200)}
            truncated={parsed.truncated}
            initial={initial}
          />
        </CardContent>
      </Card>
    </div>
  );
}
