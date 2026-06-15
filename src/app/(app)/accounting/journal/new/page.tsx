import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import {
  JournalEntryForm,
  type JournalAccountOption,
} from '@/modules/accounting/components/journal-entry-form';

export const dynamic = 'force-dynamic';

export default async function NewJournalEntryPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) redirect('/accounting/journal' as never);
  const company = await getActiveCompany();

  const accounts = await listAccountingAccounts(company.id);
  // Postable accounts = everything not archived and not a section header. A
  // header is a parent_id-null account that has children; flat accounts
  // (bank, 4000 Sales, …) are postable even though parent_id is null.
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

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link
          href={{ pathname: '/accounting/journal' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to General Ledger
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          New journal entry
        </h1>
        <p className="text-sm text-slate-500">
          Post a balanced double-entry adjustment — opening balances,
          corrections, accruals. Debits must equal credits.
        </p>
      </div>

      <JournalEntryForm accounts={options} defaultDate={today} />
    </div>
  );
}
