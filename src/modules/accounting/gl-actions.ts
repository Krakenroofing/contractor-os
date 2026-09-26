'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import {
  findMirrorEntries,
  getEntryIcOrigin,
  getIntercompanyLink,
  listIntercompanyLinks,
  postIntercompanyMirror,
} from '@/lib/data/intercompany';
import { canPostInPartner } from './lib/intercompany-access';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate, canView } from '@/lib/permissions';
import {
  deleteManualJournalEntry,
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
import { guardPeriod } from '@/lib/period-guard';
import { closedPeriodMessageFor } from '@/lib/data/accounting-periods';
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
  /** Intercompany mirror offsets: partner company id → account in the
   *  partner's books (default: its Intercompany Clearing account). */
  mirrorOffsets?: Record<string, string | null>;
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
  const company = await getActiveCompany();
  const companyId = company.id;

  // Intercompany (P7): lines on an intercompany account post their mirror
  // in the partner company. Everything is checked BEFORE this side posts.
  const links = await listIntercompanyLinks(companyId);
  const mirrors: Array<{
    partnerLink: NonNullable<Awaited<ReturnType<typeof getIntercompanyLink>>>;
    partnerName: string;
    net: number;
    offsetAccountId: string | null;
  }> = [];
  for (const link of links) {
    const net =
      Math.round(
        parsed.data.lines
          .filter((l) => l.accountId === link.accountId)
          .reduce((s, l) => s + l.debit - l.credit, 0) * 100,
      ) / 100;
    if (net === 0) continue;
    if (!(await canPostInPartner(user.id, link.partnerCompanyId))) {
      return {
        ok: false,
        error: `This entry moves the intercompany account with ${link.partnerName}. Its mirror posts in ${link.partnerName}'s books, so you need owner or accounting access there.`,
      };
    }
    const partnerLink = await getIntercompanyLink(link.partnerCompanyId, companyId);
    if (!partnerLink) {
      return {
        ok: false,
        error: `${link.partnerName} has no intercompany account set up for ${company.name} yet (Reports → Intercompany).`,
      };
    }
    const closed = await closedPeriodMessageFor(
      link.partnerCompanyId,
      [parsed.data.entryDate],
      `The ${link.partnerName} mirror`,
    );
    if (closed) return { ok: false, error: closed };
    mirrors.push({
      partnerLink,
      partnerName: link.partnerName,
      net,
      offsetAccountId: input.mirrorOffsets?.[link.partnerCompanyId] || null,
    });
  }

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
    for (const m of mirrors) {
      try {
        await postIntercompanyMirror({
          originCompanyId: companyId,
          originCompanyName: company.name,
          partnerLink: m.partnerLink,
          originNet: m.net,
          entryDate: parsed.data.entryDate,
          memo: parsed.data.memo ?? null,
          originEntryId: id,
          offsetAccountId: m.offsetAccountId,
          createdByUserId: user.id,
        });
      } catch (err) {
        // Keep both books consistent: take this side back out.
        await reverseJournalEntry(companyId, id, {
          entryDate: parsed.data.entryDate,
          memo: 'Reversal — intercompany mirror could not post',
          createdByUserId: user.id,
        });
        return {
          ok: false,
          error: `The ${m.partnerName} mirror could not post, so this entry was reversed: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
      }
    }
    revalidatePath('/accounting/journal');
    revalidatePath('/reports/trial-balance');
    revalidatePath('/reports/intercompany');
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

// Posted journal entries are FINAL (roadmap Priority 1): no edit in place,
// no delete. Manual entries post on save (there is no draft state), so the
// only correction is Reverse — which keeps both the original and its
// mirror on record — followed by a new corrected entry.
const JE_FINAL_ERROR =
  'Posted journal entries are final. Use “Reverse & correct” — the original and its reversal both stay on record, and a pre-filled corrected entry opens.';

export async function updateManualJournalEntryAction(_input: {
  entryId: string;
}): Promise<PostJournalEntryResult> {
  return { ok: false, error: JE_FINAL_ERROR };
}

export async function deleteManualJournalEntryAction(
  _entryId: string,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: JE_FINAL_ERROR };
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
  /** Ignored when absent: the server picks the reversal date. */
  entryDate?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'No permission to reverse entries.' };
  }
  const id = z.string().uuid().safeParse(input.entryId);
  if (!id.success) return { ok: false, error: 'Invalid entry.' };
  const companyId = await getActiveCompanyId();
  // Standard reversal dating: on the ORIGINAL date while that month is open
  // (the correction nets to zero inside the same month), otherwise today —
  // a closed month can't take new postings.
  const original = await getJournalEntryWithLines(companyId, id.data);
  if (!original) return { ok: false, error: 'Entry not found.' };
  const today = new Date().toISOString().slice(0, 10);
  const reversalDate = (await closedPeriodMessageFor(
    companyId,
    [original.entryDate],
    'x',
  ))
    ? today
    : original.entryDate;

  // Intercompany pair (P7): an entry and its mirror are reversed together
  // so the two companies' books keep agreeing.
  const pairTargets: Array<{ companyId: string; entryId: string; entryDate: string }> = [];
  const origin = await getEntryIcOrigin(companyId, id.data);
  const originCompanyId = origin?.originCompanyId ?? companyId;
  const originEntryId = origin?.originEntryId ?? id.data;
  if (origin) {
    const o = await getJournalEntryWithLines(origin.originCompanyId, origin.originEntryId);
    if (o && !o.reversedByEntryId) {
      pairTargets.push({
        companyId: origin.originCompanyId,
        entryId: origin.originEntryId,
        entryDate: o.entryDate,
      });
    }
  }
  for (const m of await findMirrorEntries(originCompanyId, originEntryId)) {
    if (m.id !== id.data) pairTargets.push({ companyId: m.companyId, entryId: m.id, entryDate: m.entryDate });
  }
  for (const t of pairTargets) {
    if (!(await canPostInPartner(user.id, t.companyId))) {
      return {
        ok: false,
        error:
          'This entry is one half of an intercompany pair; reversing it also reverses the other company’s side, which needs owner or accounting access there.',
      };
    }
  }
  const guarded = await guardPeriod(
    async () => ({
      res: await reverseJournalEntry(companyId, id.data, {
        entryDate: reversalDate,
        createdByUserId: user.id,
      }),
      error: null as string | null,
    }),
    (msg) => ({
      res: null,
      error: `${msg} Date the reversal in an open period.`,
    }),
  );
  if (guarded.error) return { ok: false, error: guarded.error };
  const res = guarded.res;
  if (!res) return { ok: false, error: 'Entry not found or already reversed.' };
  for (const t of pairTargets) {
    const closed = await closedPeriodMessageFor(t.companyId, [t.entryDate], 'x');
    try {
      await reverseJournalEntry(t.companyId, t.entryId, {
        entryDate: closed ? today : t.entryDate,
        memo: 'Reversal — intercompany pair reversed together',
        createdByUserId: user.id,
      });
    } catch {
      return {
        ok: false,
        error:
          'This side was reversed, but the other company’s side could not be — reverse it there (Reports → Intercompany shows it).',
      };
    }
  }
  revalidatePath('/accounting/journal');
  revalidatePath('/reports/trial-balance');
  revalidatePath('/reports/intercompany');
  return { ok: true };
}
