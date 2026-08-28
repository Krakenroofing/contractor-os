'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate, canView } from '@/lib/permissions';
import {
  postJournalEntry,
  reverseJournalEntry,
  updateManualJournalEntry,
  UnbalancedJournalEntryError,
} from '@/lib/data/general-ledger';
import { getJournalEntryWithLines } from '@/lib/data/general-ledger';
import {
  createJournalEntryAttachment,
  deleteJournalEntryAttachment,
  getJournalEntryAttachment,
} from '@/lib/data/journal-entry-attachments';
import { getUserNamesByIds } from '@/lib/data/users';
import {
  ALLOWED_JOURNAL_ATTACHMENT_MIME,
  JOURNAL_ENTRY_ATTACHMENTS_BUCKET,
  MAX_JOURNAL_ATTACHMENT_BYTES,
  createSignedJournalAttachmentUrl,
  deleteJournalAttachmentBlob,
  extForJournalAttachmentUpload,
} from '@/lib/storage/journal-entry-attachments';
import {
  createSignedUploadForBucket,
  removeStorageObject,
  statStorageObject,
} from '@/lib/storage/signed-upload';
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

// =============================================================================
// Journal-entry attachments — the working papers behind a manual adjustment.
// Direct-to-storage signed uploads (same pipeline as team-task attachments):
// mint URLs → browser PUTs blobs → attach action re-stats each blob and
// records the rows. Manual entries only: system entries are deleted and
// re-created by GL rebuilds, which would cascade-orphan any attachment.
// =============================================================================

const attachmentUploadRequestsSchema = z
  .array(
    z.object({
      fileName: z.string().min(1).max(300),
      mimeType: z.string().min(1).max(100),
      byteSize: z.number().int().positive(),
    }),
  )
  .min(1)
  .max(10);

export type JournalUploadUrlGrant = {
  fileName: string;
  storagePath?: string;
  signedUrl?: string;
  error?: string;
};

async function guardAttachableEntry(
  companyId: string,
  entryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const entry = await getJournalEntryWithLines(companyId, entryId);
  if (!entry) return { ok: false, error: 'Journal entry not found.' };
  if (entry.sourceType !== 'manual') {
    return {
      ok: false,
      error:
        'Files can only be attached to manual journal entries — system entries are rebuilt from their sources.',
    };
  }
  return { ok: true };
}

export async function createJournalAttachmentUploadUrlsAction(
  entryId: string,
  requests: unknown,
): Promise<{ formError?: string; uploads?: JournalUploadUrlGrant[] }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { formError: 'You do not have permission to attach files here.' };
  }
  const id = z.string().uuid().safeParse(entryId);
  if (!id.success) return { formError: 'Invalid entry.' };
  const companyId = await getActiveCompanyId();
  const guard = await guardAttachableEntry(companyId, id.data);
  if (!guard.ok) return { formError: guard.error };
  const parsed = attachmentUploadRequestsSchema.safeParse(requests);
  if (!parsed.success) return { formError: 'Invalid upload request.' };

  const uploads: JournalUploadUrlGrant[] = [];
  for (const req of parsed.data) {
    const mime = req.mimeType.toLowerCase();
    if (!ALLOWED_JOURNAL_ATTACHMENT_MIME.has(mime)) {
      uploads.push({
        fileName: req.fileName,
        error: `Unsupported file type (${req.mimeType}).`,
      });
      continue;
    }
    if (req.byteSize > MAX_JOURNAL_ATTACHMENT_BYTES) {
      uploads.push({
        fileName: req.fileName,
        error: `Too large (max ${Math.round(MAX_JOURNAL_ATTACHMENT_BYTES / 1024 / 1024)}MB).`,
      });
      continue;
    }
    try {
      const grant = await createSignedUploadForBucket({
        bucket: JOURNAL_ENTRY_ATTACHMENTS_BUCKET,
        companyId,
        scopeSegments: [id.data],
        ext: extForJournalAttachmentUpload(req.fileName, mime),
      });
      if (!grant) {
        uploads.push({
          fileName: req.fileName,
          error: 'File storage is not configured.',
        });
        continue;
      }
      uploads.push({
        fileName: req.fileName,
        storagePath: grant.storagePath,
        signedUrl: grant.signedUrl,
      });
    } catch (err) {
      uploads.push({
        fileName: req.fileName,
        error: err instanceof Error ? err.message : 'Could not start upload.',
      });
    }
  }
  return { uploads };
}

const attachmentRefSchema = z.object({
  storagePath: z.string().min(1).max(500),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().nonnegative(),
});

export async function attachJournalEntryFilesAction(
  entryId: string,
  refs: unknown,
): Promise<{ ok: boolean; error?: string; failures?: string[] }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to attach files here.' };
  }
  const id = z.string().uuid().safeParse(entryId);
  if (!id.success) return { ok: false, error: 'Invalid entry.' };
  const parsedRefs = z.array(attachmentRefSchema).min(1).max(10).safeParse(refs);
  if (!parsedRefs.success) return { ok: false, error: 'Invalid upload refs.' };
  const companyId = await getActiveCompanyId();
  const guard = await guardAttachableEntry(companyId, id.data);
  if (!guard.ok) return { ok: false, error: guard.error };

  // Dev-demo guard: stamp uploaded_by only when the user row exists.
  const known = await getUserNamesByIds([user.id]);
  const uploadedBy = known.has(user.id) ? user.id : null;

  const failures: string[] = [];
  for (const ref of parsedRefs.data) {
    if (!ref.storagePath.startsWith(`${companyId}/`)) {
      failures.push(`${ref.fileName}: invalid upload path.`);
      continue;
    }
    const stat = await statStorageObject(
      JOURNAL_ENTRY_ATTACHMENTS_BUCKET,
      ref.storagePath,
    );
    if (!stat) {
      failures.push(`${ref.fileName}: upload not found — retry.`);
      continue;
    }
    if (stat.byteSize > MAX_JOURNAL_ATTACHMENT_BYTES) {
      await removeStorageObject(JOURNAL_ENTRY_ATTACHMENTS_BUCKET, ref.storagePath);
      failures.push(`${ref.fileName}: too large.`);
      continue;
    }
    const mime = (
      stat.mimeType && stat.mimeType !== 'application/octet-stream'
        ? stat.mimeType
        : ref.mimeType
    ).toLowerCase();
    if (!ALLOWED_JOURNAL_ATTACHMENT_MIME.has(mime)) {
      await removeStorageObject(JOURNAL_ENTRY_ATTACHMENTS_BUCKET, ref.storagePath);
      failures.push(`${ref.fileName}: unsupported file type (${mime}).`);
      continue;
    }
    try {
      await createJournalEntryAttachment({
        companyId,
        journalEntryId: id.data,
        uploadedBy,
        originalFileName: ref.fileName,
        storagePath: ref.storagePath,
        mimeType: mime,
        byteSize: stat.byteSize,
      });
    } catch (err) {
      failures.push(
        `${ref.fileName}: ${err instanceof Error ? err.message : 'failed to attach.'}`,
      );
    }
  }
  revalidatePath('/accounting/journal');
  return failures.length === parsedRefs.data.length
    ? { ok: false, error: failures.join(' ') }
    : { ok: true, failures: failures.length ? failures : undefined };
}

export async function deleteJournalEntryAttachmentAction(
  attachmentId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to remove files here.' };
  }
  const id = z.string().uuid().safeParse(attachmentId);
  if (!id.success) return { ok: false, error: 'Invalid attachment.' };
  const companyId = await getActiveCompanyId();
  const existing = await getJournalEntryAttachment(companyId, id.data);
  if (!existing) return { ok: false, error: 'Attachment not found.' };
  await deleteJournalEntryAttachment(companyId, id.data);
  await deleteJournalAttachmentBlob(existing.storagePath);
  revalidatePath('/accounting/journal');
  return { ok: true };
}

/** Signed inline-view URL for an attachment (image thumbnails). */
export async function getJournalAttachmentViewUrlAction(
  attachmentId: string,
): Promise<{ url?: string; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'accounting_accounts')) {
    return { error: 'No permission.' };
  }
  const id = z.string().uuid().safeParse(attachmentId);
  if (!id.success) return { error: 'Invalid attachment.' };
  const companyId = await getActiveCompanyId();
  const att = await getJournalEntryAttachment(companyId, id.data);
  if (!att) return { error: 'Not found.' };
  const url = await createSignedJournalAttachmentUrl(att.storagePath, 3600);
  return url ? { url } : { error: 'Storage not configured.' };
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
