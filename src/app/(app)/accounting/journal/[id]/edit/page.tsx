import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { getJournalEntryWithLines } from '@/lib/data/general-ledger';
import {
  JournalEntryForm,
  type JournalAccountOption,
} from '@/modules/accounting/components/journal-entry-form';

export const dynamic = 'force-dynamic';

// Edit a MANUAL journal entry in place. System-posted entries (bank /
// invoice / receipt / …) are rebuilt from their sources, so they can't be
// edited here — and entries in a reversal pair stay frozen.
export default async function EditJournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) redirect('/accounting/journal' as never);
  const company = await getActiveCompany();
  const { id } = await params;

  const entry = await getJournalEntryWithLines(company.id, id);
  if (!entry) notFound();

  const editable =
    entry.sourceType === 'manual' &&
    !entry.reversedByEntryId &&
    !entry.reversesEntryId;

  const accounts = await listAccountingAccounts(company.id);
  const parentIds = new Set(
    accounts.map((a) => a.parentId).filter((p): p is string => !!p),
  );
  const options: JournalAccountOption[] = accounts
    .filter((a) => !a.isArchived && !parentIds.has(a.id))
    .map((a) => ({
      id: a.id,
      label: `${a.code ? `${a.code} ` : ''}${a.name}`,
      group: a.rollupGroup,
    }));

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link
          href={`/accounting/journal?entry=${entry.id}` as never}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to the entry
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          Edit journal entry
        </h1>
        <p className="text-sm text-slate-500">
          {entry.entryDate} · {entry.memo ?? '(no memo)'} — changes replace the
          entry&apos;s date, memo, and lines. Debits must equal credits.
        </p>
      </div>

      {editable ? (
        <JournalEntryForm
          accounts={options}
          defaultDate={entry.entryDate}
          initial={{
            entryId: entry.id,
            entryDate: entry.entryDate,
            memo: entry.memo ?? '',
            lines: entry.lines.map((l) => ({
              accountId: l.accountId,
              debit: Number(l.debit),
              credit: Number(l.credit),
              description: l.description ?? null,
            })),
          }}
        />
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {entry.sourceType !== 'manual'
            ? 'This entry is posted automatically from its source record — edit the source (bank transaction, receipt, invoice…) and the ledger follows.'
            : 'This entry is part of a reversal pair and stays frozen — post a new entry for further corrections.'}
        </div>
      )}
    </div>
  );
}
