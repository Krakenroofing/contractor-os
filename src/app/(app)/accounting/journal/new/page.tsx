import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { getJournalEntryWithLines } from '@/lib/data/general-ledger';
import { closedPeriodMessageFor } from '@/lib/data/accounting-periods';
import {
  JournalEntryForm,
  type JournalAccountOption,
  type JournalIcLink,
} from '@/modules/accounting/components/journal-entry-form';
import { requireAuth } from '@/lib/auth';
import { listIntercompanyLinks } from '@/lib/data/intercompany';
import { canPostInPartner } from '@/modules/accounting/lib/intercompany-access';

export const dynamic = 'force-dynamic';

export default async function NewJournalEntryPage({
  searchParams,
}: {
  // ?correctionOf=<entryId> — the "Reverse & correct" flow: the original
  // was just reversed, so start the replacement from its lines.
  searchParams: Promise<{ correctionOf?: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) redirect('/accounting/journal' as never);
  const company = await getActiveCompany();
  const { correctionOf } = await searchParams;

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

  // Intercompany accounts in this company → where their mirrors post (P7).
  const user = await requireAuth();
  const icLinks: JournalIcLink[] = [];
  for (const link of await listIntercompanyLinks(company.id)) {
    const allowed = await canPostInPartner(user.id, link.partnerCompanyId);
    const partnerAccounts = allowed
      ? await listAccountingAccounts(link.partnerCompanyId)
      : [];
    const partnerParents = new Set(
      partnerAccounts.map((a) => a.parentId).filter((p): p is string => !!p),
    );
    icLinks.push({
      accountId: link.accountId,
      partnerCompanyId: link.partnerCompanyId,
      partnerName: link.partnerName,
      clearingAccountId: link.clearingAccountId,
      partnerAccounts: allowed
        ? partnerAccounts
            .filter((a) => !a.isArchived && !partnerParents.has(a.id))
            .map((a) => ({
              id: a.id,
              label: `${a.code ? `${a.code} ` : ''}${a.name}`,
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
        : null,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const original =
    correctionOf && /^[0-9a-f-]{36}$/i.test(correctionOf)
      ? await getJournalEntryWithLines(company.id, correctionOf)
      : null;
  // The correction lands on the original's date while that month is open,
  // otherwise today (a closed month can't take new postings).
  const correctionDate =
    original &&
    !(await closedPeriodMessageFor(company.id, [original.entryDate], 'x'))
      ? original.entryDate
      : today;

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
          {original ? 'Corrected journal entry' : 'New journal entry'}
        </h1>
        <p className="text-sm text-slate-500">
          {original
            ? `The original entry (${original.entryDate} · ${original.memo ?? 'no memo'}) was reversed — both stay on record. Adjust the lines below and post the corrected version.`
            : 'Post a balanced double-entry adjustment — opening balances, corrections, accruals. Debits must equal credits. Posted entries are final; corrections are made by reversing.'}
        </p>
      </div>

      <JournalEntryForm
        accounts={options}
        icLinks={icLinks}
        defaultDate={original ? correctionDate : today}
        prefill={
          original
            ? {
                memo: `Correction of: ${original.memo ?? original.entryDate}`,
                lines: original.lines.map((l) => ({
                  accountId: l.accountId,
                  debit: Number(l.debit),
                  credit: Number(l.credit),
                  description: l.description ?? null,
                })),
              }
            : undefined
        }
      />
    </div>
  );
}
