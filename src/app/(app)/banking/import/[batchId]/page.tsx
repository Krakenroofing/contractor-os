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
import {
  parseStatementBytes,
  StatementParseError,
} from '@/modules/banking/lib/parse';
import { MappingWizard } from '@/modules/banking/components/mapping-wizard';
import { DeleteImportBatchButton } from '@/modules/banking/components/delete-import-batch-button';
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
  // Parse failures (renamed CSVs, corrupted downloads, unsupported types)
  // render as a contained message with a way to remove the bad batch —
  // never as a crashed page.
  let parsed;
  try {
    parsed = await parseStatementBytes({
      bytes,
      mimeType: batch.mimeType,
      filename: batch.sourceFilename,
    });
  } catch (err) {
    const message =
      err instanceof StatementParseError
        ? err.message
        : `This file isn't a valid Excel file. Please upload .xlsx exported from your bank, or a .csv.`;
    return (
      <div className="p-6 space-y-4">
        <Link
          href={{ pathname: '/banking' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Banking
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">
          Can&apos;t read {batch.sourceFilename}
        </h1>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 max-w-xl">
          {message}
        </div>
        <DeleteImportBatchButton
          batchId={batch.id}
          filename={batch.sourceFilename}
          rowCount={null}
          redirectOnSuccess={`/banking/accounts/${account.id}`}
        />
      </div>
    );
  }

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
      <div className="flex items-start justify-between gap-4">
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
        <DeleteImportBatchButton
          batchId={batch.id}
          filename={batch.sourceFilename}
          rowCount={parsed.rows.length}
          redirectOnSuccess="/banking"
        />
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
