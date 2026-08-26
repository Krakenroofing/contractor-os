'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  postJournalEntry,
  reverseJournalEntry,
  updateManualJournalEntry,
  UnbalancedJournalEntryError,
} from '@/lib/data/general-ledger';
import { rebuildGlFromInvoicesAndPayments } from './lib/gl-posting';

export type PostJournalEntryResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const lineSchema = z.object({
  accountId: z.string().uuid('Pick an account for every line'),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  description: z.string().max(500).optional().nullable(),
});

const postSchema = z.object({
  entryDate: z.string().min(1, 'Entry date is required'),
  memo: z.string().max(1000).optional().nullable(),
  lines: z.array(lineSchema).min(2, 'A journal entry needs at least two lines'),
});

/**
 * Post a manual journal entry into the GL — for opening balances and
 * adjustments. Validates balance (debits == credits) in postJournalEntry.
 */
export async function postManualJournalEntryAction(input: {
  entryDate: string;
  memo?: string | null;
  lines: Array<{
    accountId: string;
    debit: number;
    credit: number;
    description?: string | null;
  }>;
}): Promise<PostJournalEntryResult> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to post journal entries.' };
  }
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.flatten().formErrors[0] ??
        Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ??
        'Invalid journal entry.',
    };
  }
  const companyId = await getActiveCompanyId();
  try {
    const { id } = await postJournalEntry(companyId, {
      entryDate: parsed.data.entryDate,
      memo: parsed.data.memo ?? null,
      sourceType: 'manual',
      createdByUserId: user.id,
      lines: parsed.data.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description ?? null,
      })),
    });
    revalidatePath('/accounting/journal');
    revalidatePath('/reports/trial-balance');
    return { ok: true, id };
  } catch (err) {
    const error =
      err instanceof UnbalancedJournalEntryError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not post the entry.';
    return { ok: false, error };
  }
}

/** Rewrite a MANUAL journal entry (date, memo, lines) in place. System
 *  entries and reversal pairs are refused by the data layer. */
export async function updateManualJournalEntryAction(input: {
  entryId: string;
  entryDate: string;
  memo?: string | null;
  lines: Array<{
    accountId: string;
    debit: number;
    credit: number;
    description?: string | null;
  }>;
}): Promise<PostJournalEntryResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to edit journal entries.' };
  }
  const entryId = z.string().uuid().safeParse(input.entryId);
  if (!entryId.success) return { ok: false, error: 'Invalid entry.' };
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.flatten().formErrors[0] ??
        Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ??
        'Invalid journal entry.',
    };
  }
  const companyId = await getActiveCompanyId();
  const res = await updateManualJournalEntry(companyId, entryId.data, {
    entryDate: parsed.data.entryDate,
    memo: parsed.data.memo ?? null,
    lines: parsed.data.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
    })),
  });
  if ('error' in res) return { ok: false, error: res.error };
  revalidatePath('/accounting/journal');
  revalidatePath('/reports/trial-balance');
  return { ok: true, id: res.id };
}

export type RebuildGlState = {
  ok: boolean;
  postedInvoices?: number;
  postedPayments?: number;
  postedReceipts?: number;
  postedBankTxns?: number;
  postedOpenings?: number;
  failures?: string[];
  error?: string;
};

/**
 * Backfill / resync the GL from all non-void invoices + their payments
 * (Phase 3.2). Idempotent — safe to re-run after invoices change.
 */
export async function rebuildGlAction(): Promise<RebuildGlState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to rebuild the ledger.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const res = await rebuildGlFromInvoicesAndPayments(companyId);
    revalidatePath('/accounting/journal');
    revalidatePath('/reports/trial-balance');
    return { ok: true, ...res };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Rebuild failed.',
    };
  }
}

/** Reverse a posted journal entry (creates a mirror entry). */
export async function reverseJournalEntryAction(input: {
  entryId: string;
  entryDate: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'No permission to reverse entries.' };
  }
  const id = z.string().uuid().safeParse(input.entryId);
  if (!id.success) return { ok: false, error: 'Invalid entry.' };
  const companyId = await getActiveCompanyId();
  const res = await reverseJournalEntry(companyId, id.data, {
    entryDate: input.entryDate,
    createdByUserId: user.id,
  });
  if (!res) return { ok: false, error: 'Entry not found or already reversed.' };
  revalidatePath('/accounting/journal');
  revalidatePath('/reports/trial-balance');
  return { ok: true };
}
