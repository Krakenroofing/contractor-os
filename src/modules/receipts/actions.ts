'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  getActiveCompany,
  getActiveCompanyId,
} from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { syncReceiptGl } from '@/modules/accounting/lib/gl-posting';
import {
  can,
  canApproveReceipt,
  canCreate,
  canView,
} from '@/lib/permissions';
import { toMoneyString, toPercentString } from '@/lib/money';
import {
  ALLOWED_RECEIPT_MIME,
  MAX_RECEIPT_BYTES,
  RECEIPT_FILES_BUCKET,
  ReceiptStorageNotConfiguredError,
  extForUpload,
  uploadReceiptFile,
  deleteReceiptBlob,
  downloadReceiptBlob,
} from '@/lib/storage/receipt-files';
import {
  createSignedUploadForBucket,
  removeStorageObject,
  statStorageObject,
} from '@/lib/storage/signed-upload';
import {
  createReceipt,
  createReceiptAttachment,
  createReceiptLine,
  getReceipt,
  listReceiptAttachments,
  listReceiptLines,
  recalcReceiptHeaderTotals,
  softDeleteReceipt,
  softDeleteReceiptAttachment,
  softDeleteReceiptLine,
  updateReceipt,
  updateReceiptLine,
} from '@/lib/data/receipts';
import {
  createJobCostEntry,
  softDeleteJobCostEntry,
} from '@/lib/data/job-cost-entries';
import {
  upsertReceiptSchema,
  upsertReceiptLineSchema,
  costTypeValues,
  type UpsertReceiptLineInput,
} from './schema';
import { computeVat, vatQuarterForDate } from './lib/vat';
import { listVendors } from '@/lib/data/vendors';
import { getUserNamesByIds } from '@/lib/data/users';
import {
  extractReceipt,
  isOcrConfigured,
  type OcrExtractResult,
} from '@/lib/ocr/document-ai';

export type ReceiptActionState = {
  formError?: string;
  errors?: Record<string, string[]>;
  ok?: boolean;
  receiptId?: string;
};

const idSchema = z.string().uuid();

// ===== Upsert (draft only) =====

export async function upsertReceiptAction(
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { formError: 'You do not have permission to manage receipts.' };
  }
  const company = await getActiveCompany();

  // Lines come over as a JSON-encoded array. Parse defensively — a malformed
  // payload should produce a form error, not a 500.
  const rawLines = formData.get('lines');
  let parsedLines: UpsertReceiptLineInput[] = [];
  if (typeof rawLines === 'string' && rawLines.length > 0) {
    let arr: unknown;
    try {
      arr = JSON.parse(rawLines);
    } catch {
      return { formError: 'Could not parse lines payload.' };
    }
    if (!Array.isArray(arr)) {
      return { formError: 'Lines payload must be an array.' };
    }
    const each = z.array(upsertReceiptLineSchema).max(50).safeParse(arr);
    if (!each.success) {
      return {
        formError: 'Fix the highlighted line fields.',
        errors: each.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }
    parsedLines = each.data;
  }

  const parsed = upsertReceiptSchema.safeParse({
    id: (formData.get('id') as string) || undefined,
    receiptDate: formData.get('receiptDate') ?? '',
    vendorId: formData.get('vendorId') ?? '',
    bankAccountId: formData.get('bankAccountId') ?? '',
    paymentMethodId: formData.get('paymentMethodId') ?? '',
    paymentSourceType: formData.get('paymentSourceType') ?? 'cash',
    currency: formData.get('currency') ?? company.defaultCurrency,
    vatRatePercent: formData.get('vatRatePercent') ?? '',
    vatIncluded:
      formData.get('vatIncluded') === 'on' ||
      formData.get('vatIncluded') === 'true',
    vatRecoverable:
      formData.get('vatRecoverable') === 'on' ||
      formData.get('vatRecoverable') === 'true',
    vendorTin: formData.get('vendorTin') ?? '',
    vendorInvoiceNumber: formData.get('vendorInvoiceNumber') ?? '',
    notes: formData.get('notes') ?? '',
    lines: parsedLines,
  });
  if (!parsed.success) {
    return {
      formError: 'Fix the highlighted fields.',
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  // Server-side recompute of every line's VAT triplet — guarantees
  // subtotal + vatAmount = total per line even if the client form drifted.
  const computedLines = d.lines.map((line, idx) => {
    const lineRate = line.vatRatePercent ?? d.vatRatePercent ?? 0;
    const c = company.isVatActive
      ? computeVat({
          subtotal: line.subtotal,
          vatAmount: line.vatAmount,
          total: line.total,
          vatRatePercent: lineRate ?? 0,
          vatIncluded: d.vatIncluded ?? true,
          driver: 'init',
        })
      : {
          subtotal: line.total > 0 ? line.total : line.subtotal,
          vatAmount: 0,
          total: line.total > 0 ? line.total : line.subtotal,
          vatRatePercent: 0,
        };
    return { line, computed: c, sortOrder: line.sortOrder ?? idx };
  });

  // Header values. Money columns are denormalized — computed below from lines.
  const header = {
    companyId: company.id,
    vendorId: d.vendorId,
    paymentSourceType: d.paymentSourceType,
    paymentMethodId: d.paymentMethodId,
    bankAccountId:
      d.paymentSourceType === 'bank' || d.paymentSourceType === 'credit_card'
        ? d.bankAccountId
        : null,
    receiptDate: d.receiptDate,
    currency: d.currency,
    vatRatePercent:
      d.vatRatePercent === null ? null : toPercentString(d.vatRatePercent),
    vatIncluded: d.vatIncluded ?? true,
    vatRecoverable: d.vatRecoverable ?? true,
    vatPeriodQuarter: company.isVatActive
      ? vatQuarterForDate(d.receiptDate)
      : null,
    vendorTin: d.vendorTin,
    vendorInvoiceNumber: d.vendorInvoiceNumber,
    notes: d.notes,
    uploadedByUserId: user.id,
  } as const;

  if (d.id) {
    // Refuse edits on a locked receipt. Posted → must Unpost. Submitted →
    // approver must Reject (sends back to draft) before changes are allowed.
    const existing = await getReceipt(company.id, d.id);
    if (!existing) return { formError: 'Receipt not found.' };
    if (existing.status === 'posted') {
      return {
        formError:
          'This receipt is posted. Unpost it first if you need to edit.',
      };
    }
    if (existing.status === 'submitted') {
      return {
        formError:
          'This receipt is submitted for review. Reject it first if changes are needed.',
      };
    }
    await updateReceipt(company.id, d.id, header);
    await replaceReceiptLines(company.id, d.id, computedLines);
    await recalcReceiptHeaderTotals(company.id, d.id);
    revalidatePath('/banking/receipts');
    revalidatePath(`/banking/receipts/${d.id}`);
    return { ok: true, receiptId: d.id };
  }

  // New receipt. Start with zero header totals; recalc after lines insert.
  const created = await createReceipt({
    ...header,
    subtotal: '0',
    vatAmount: '0',
    total: '0',
  });
  await replaceReceiptLines(company.id, created.id, computedLines);
  await recalcReceiptHeaderTotals(company.id, created.id);
  revalidatePath('/banking/receipts');
  redirect(`/banking/receipts/${created.id}` as never);
}

/** Reconcile in-memory line input against the persisted lines: update existing,
 *  insert new, soft-delete any persisted line whose id is no longer present.
 *
 *  Reimbursement guard: if a persisted line already has a payout linked
 *  (reimbursementPayoutId is set), we preserve its money + reimbursable
 *  flag + paid-by ref so the operator can't accidentally unwind a real
 *  cash-out by editing the draft. The action layer also blocks edits on
 *  posted/submitted receipts, so this only matters for the rare case of
 *  an unposted-then-re-edited line.
 */
async function replaceReceiptLines(
  companyId: string,
  receiptId: string,
  inputs: Array<{
    line: UpsertReceiptLineInput;
    computed: { subtotal: number; vatAmount: number; total: number; vatRatePercent: number };
    sortOrder: number;
  }>,
): Promise<{ reimbursementLocked: boolean }> {
  const existing = await listReceiptLines(companyId, receiptId);
  const existingById = new Map(existing.map((l) => [l.id, l]));
  const seenIds = new Set<string>();
  let reimbursementLocked = false;

  for (const { line, computed, sortOrder } of inputs) {
    const persisted = line.id ? existingById.get(line.id) : undefined;
    const alreadyPaidOut = Boolean(persisted?.reimbursementPayoutId);
    if (alreadyPaidOut) reimbursementLocked = true;

    const values = {
      sortOrder,
      projectId: line.projectId,
      costCodeId: line.costCodeId,
      accountingAccountId: line.accountingAccountId,
      costType: line.costType,
      description: line.description,
      subtotal: alreadyPaidOut ? persisted!.subtotal : toMoneyString(computed.subtotal),
      vatAmount: alreadyPaidOut ? persisted!.vatAmount : toMoneyString(computed.vatAmount),
      total: alreadyPaidOut ? persisted!.total : toMoneyString(computed.total),
      vatRatePercent: alreadyPaidOut
        ? persisted!.vatRatePercent
        : line.vatRatePercent === null
          ? null
          : toPercentString(line.vatRatePercent),
      isBillable: line.isBillable ?? false,
      isReimbursable: alreadyPaidOut ? true : line.isReimbursable ?? false,
      paidByUserId: alreadyPaidOut ? persisted!.paidByUserId : line.paidByUserId,
    } as const;

    if (line.id && existingById.has(line.id)) {
      seenIds.add(line.id);
      await updateReceiptLine(companyId, line.id, values);
    } else {
      await createReceiptLine({
        companyId,
        receiptId,
        ...values,
      });
    }
  }

  // Soft-delete any persisted line that the form removed — unless it's
  // already been paid out, in which case we keep it (the audit trail must
  // outlive the form). Operator who really wants it gone has to reverse
  // the payout first.
  for (const e of existing) {
    if (!seenIds.has(e.id)) {
      if (e.reimbursementPayoutId) {
        reimbursementLocked = true;
        continue;
      }
      await softDeleteReceiptLine(companyId, e.id);
    }
  }
  return { reimbursementLocked };
}

// ===== File attachments =====

// ===========================================================================
// Direct-to-storage uploads
// ===========================================================================
//
// Vercel rejects request bodies over ~4.5MB before a server action runs,
// so big receipt PDFs/photos posted through a form action die silently.
// Instead the client asks this action for signed upload URLs, PUTs the
// files straight to the receipt-files bucket, and passes path refs to the
// finalize actions below (which re-stat each blob server-side — client
// metadata is never trusted).

export type UploadUrlGrant = {
  fileName: string;
  storagePath?: string;
  signedUrl?: string;
  error?: string;
};

export type CreateUploadUrlsState = {
  formError?: string;
  uploads?: UploadUrlGrant[];
};

const uploadUrlRequestsSchema = z
  .array(
    z.object({
      fileName: z.string().min(1).max(300),
      mimeType: z.string().min(1).max(100),
      byteSize: z.number().int().positive(),
    }),
  )
  .min(1)
  .max(50);

export async function createReceiptUploadUrlsAction(
  requests: unknown,
): Promise<CreateUploadUrlsState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { formError: 'No permission to upload files.' };
  }
  const parsed = uploadUrlRequestsSchema.safeParse(requests);
  if (!parsed.success) {
    return { formError: 'Invalid upload request.' };
  }
  const companyId = await getActiveCompanyId();
  const when = new Date();
  const year = when.getUTCFullYear().toString();
  const month = String(when.getUTCMonth() + 1).padStart(2, '0');

  const uploads: UploadUrlGrant[] = [];
  for (const req of parsed.data) {
    const mime = req.mimeType.toLowerCase();
    if (!ALLOWED_RECEIPT_MIME.has(mime)) {
      uploads.push({
        fileName: req.fileName,
        error: `Unsupported file type (${req.mimeType}).`,
      });
      continue;
    }
    if (req.byteSize > MAX_RECEIPT_BYTES) {
      uploads.push({
        fileName: req.fileName,
        error: `Too large (${(req.byteSize / 1024 / 1024).toFixed(1)}MB — max 25MB).`,
      });
      continue;
    }
    try {
      const grant = await createSignedUploadForBucket({
        bucket: RECEIPT_FILES_BUCKET,
        companyId,
        scopeSegments: [year, month],
        ext: extForUpload(req.fileName, mime),
      });
      if (!grant) {
        return { formError: new ReceiptStorageNotConfiguredError().message };
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

const directUploadRefSchema = z.object({
  storagePath: z.string().min(1).max(500),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().nonnegative(),
});
type DirectUploadRef = z.infer<typeof directUploadRefSchema>;

/** Parse the `uploads` JSON field (path refs from directUploadFiles). */
function parseUploadRefs(formData: FormData): DirectUploadRef[] {
  const raw = formData.get('uploads');
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = z
      .array(directUploadRefSchema)
      .max(50)
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Server-side verification of a direct-uploaded blob: tenant prefix, blob
 * existence, true size (over-cap blobs are deleted). Returns trusted
 * metadata or an error string.
 */
async function verifyReceiptUploadRef(
  companyId: string,
  ref: DirectUploadRef,
): Promise<
  | { ok: true; byteSize: number; mimeType: string }
  | { ok: false; error: string }
> {
  if (!ref.storagePath.startsWith(`${companyId}/`)) {
    return { ok: false, error: 'Invalid upload path.' };
  }
  const stat = await statStorageObject(RECEIPT_FILES_BUCKET, ref.storagePath);
  if (!stat) {
    return { ok: false, error: 'Upload not found in storage — retry.' };
  }
  if (stat.byteSize > MAX_RECEIPT_BYTES) {
    await removeStorageObject(RECEIPT_FILES_BUCKET, ref.storagePath);
    return { ok: false, error: 'Too large (max 25MB).' };
  }
  const mime = (
    stat.mimeType && stat.mimeType !== 'application/octet-stream'
      ? stat.mimeType
      : ref.mimeType
  ).toLowerCase();
  if (!ALLOWED_RECEIPT_MIME.has(mime)) {
    await removeStorageObject(RECEIPT_FILES_BUCKET, ref.storagePath);
    return { ok: false, error: `Unsupported file type (${mime}).` };
  }
  return { ok: true, byteSize: stat.byteSize, mimeType: mime };
}

export async function uploadReceiptAttachmentAction(
  receiptId: string,
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { formError: 'No permission to attach files.' };
  }
  const id = idSchema.safeParse(receiptId);
  if (!id.success) return { formError: 'Invalid receipt id.' };
  const companyId = await getActiveCompanyId();
  const receipt = await getReceipt(companyId, id.data);
  if (!receipt) return { formError: 'Receipt not found.' };

  const files = formData
    .getAll('file')
    .filter((f): f is File => f instanceof File && f.size > 0);
  const refs = parseUploadRefs(formData);
  if (files.length === 0 && refs.length === 0) {
    return { formError: 'Choose a file to upload.' };
  }

  const failures: string[] = [];
  let okCount = 0;

  // Dev-demo auth uses a synthetic user id that isn't in the users table —
  // stamp uploaded-by only when the id really exists so the FK can't fail.
  const knownUsers = await getUserNamesByIds([user.id]);
  const uploadedByUserId = knownUsers.has(user.id) ? user.id : null;

  // Direct-to-storage refs: blob already in the bucket — verify + record.
  for (const ref of refs) {
    const verified = await verifyReceiptUploadRef(companyId, ref);
    if (!verified.ok) {
      failures.push(`${ref.fileName}: ${verified.error}`);
      continue;
    }
    try {
      await createReceiptAttachment({
        companyId,
        receiptId: receipt.id,
        storagePath: ref.storagePath,
        mimeType: verified.mimeType,
        byteSize: verified.byteSize,
        originalFilename: ref.fileName,
        kind:
          verified.mimeType === 'application/pdf'
            ? 'supplier_invoice'
            : 'receipt_image',
        uploadedByUserId,
      });
      okCount++;
    } catch (err) {
      failures.push(
        `${ref.fileName}: ${err instanceof Error ? err.message : 'failed to record.'}`,
      );
    }
  }

  for (const file of files) {
    if (file.size > MAX_RECEIPT_BYTES) {
      failures.push(`${file.name}: too large.`);
      continue;
    }
    const mime = (file.type || 'application/octet-stream').toLowerCase();
    if (!ALLOWED_RECEIPT_MIME.has(mime)) {
      failures.push(`${file.name}: unsupported (${file.type || 'unknown'}).`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await uploadReceiptFile({
        companyId,
        bytes,
        mimeType: mime,
        originalFileName: file.name,
      });
      await createReceiptAttachment({
        companyId,
        receiptId: receipt.id,
        storagePath: upload.storagePath,
        mimeType: mime,
        byteSize: file.size,
        originalFilename: file.name,
        kind: mime === 'application/pdf' ? 'supplier_invoice' : 'receipt_image',
        uploadedByUserId,
      });
      okCount++;
    } catch (err) {
      if (err instanceof ReceiptStorageNotConfiguredError) {
        return { formError: err.message };
      }
      failures.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}.`);
    }
  }
  revalidatePath(`/banking/receipts/${receipt.id}`);
  if (failures.length > 0) {
    return {
      formError: `Uploaded ${okCount}; failed ${failures.length}: ${failures.join(' / ')}`,
    };
  }
  return { ok: true };
}

export async function deleteReceiptAttachmentAction(input: {
  receiptId: string;
  attachmentId: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) return { ok: false, error: 'No permission.' };
  const companyId = await getActiveCompanyId();
  const attachments = await listReceiptAttachments(companyId, input.receiptId);
  const target = attachments.find((a) => a.id === input.attachmentId);
  if (!target) return { ok: false, error: 'Attachment not found.' };
  await softDeleteReceiptAttachment(companyId, input.attachmentId);
  try {
    await deleteReceiptBlob(target.storagePath);
  } catch {
    /* swallow */
  }
  revalidatePath(`/banking/receipts/${input.receiptId}`);
  return { ok: true };
}

// ===== Submit / Reject (Phase 2.2 approval workflow) =====

/** Hand a draft off to an approver. Anyone with create perm can submit
 *  (including field users — that's the whole point). Idempotent on a
 *  receipt that's already submitted. */
export async function submitReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { ok: false, error: 'No permission to submit receipts.' };
  }
  const companyId = await getActiveCompanyId();
  const receipt = await getReceipt(companyId, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status === 'void') {
    return { ok: false, error: 'Receipt is void.' };
  }
  if (receipt.status === 'posted') {
    return { ok: false, error: 'Receipt is already posted.' };
  }
  if (receipt.status === 'submitted') return { ok: true };

  const lines = await listReceiptLines(companyId, receipt.id);
  if (lines.length === 0) {
    return { ok: false, error: 'Add at least one line before submitting.' };
  }
  const missing: number[] = [];
  const reimbursableMissingPayee: number[] = [];
  lines.forEach((l, idx) => {
    // A line posts as EITHER a job cost (project + cost code) or overhead
    // (an accounting category — e.g. gas/fuel, with no project). It's only
    // incomplete when it has neither.
    if (!(l.projectId && l.costCodeId) && !l.accountingAccountId) {
      missing.push(idx + 1);
    }
    if (l.isReimbursable && !l.paidByUserId) {
      reimbursableMissingPayee.push(idx + 1);
    }
  });
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Line ${missing.join(', ')}: add a project + cost code, or an accounting category, before submitting.`,
    };
  }
  if (reimbursableMissingPayee.length > 0) {
    return {
      ok: false,
      error: `Line ${reimbursableMissingPayee.join(', ')}: pick who paid out of pocket before submitting (reimbursable line).`,
    };
  }

  await updateReceipt(companyId, receipt.id, {
    status: 'submitted',
    submittedAt: new Date(),
    submittedByUserId: user.id,
    // Clear any prior rejection reason — the approver bouncing it once
    // shouldn't carry the message forward to the next review.
    rejectionReason: null,
  });
  revalidatePath('/banking/receipts');
  revalidatePath(`/banking/receipts/${receipt.id}`);
  return { ok: true };
}

/** Approver sends a submitted receipt back to draft with an optional reason.
 *  Reason is shown on the receipt detail so the submitter can act on it. */
export async function rejectReceiptAction(input: {
  id: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canApproveReceipt(role)) {
    return { ok: false, error: 'No permission to reject receipts.' };
  }
  const companyId = await getActiveCompanyId();
  const receipt = await getReceipt(companyId, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status !== 'submitted') {
    return { ok: false, error: 'Only submitted receipts can be rejected.' };
  }
  const reason = (input.reason ?? '').trim().slice(0, 1000) || null;
  await updateReceipt(companyId, receipt.id, {
    status: 'draft',
    submittedAt: null,
    submittedByUserId: null,
    rejectionReason: reason,
  });
  revalidatePath('/banking/receipts');
  revalidatePath(`/banking/receipts/${receipt.id}`);
  return { ok: true };
}

// ===== Post / Unpost =====

/**
 * Approve and post a receipt → one job_cost_entries row per receipt_lines
 * row, all sharing source='receipt_import' and source_ref_id=receipts.id.
 * Per-line link captured in receipt_lines.posted_job_cost_entry_id. Records
 * the approver in approved_at / approved_by_user_id. Callable from either
 * `submitted` (the normal flow) or `draft` (approver posting their own
 * receipt or skipping the submit step). Idempotent on `posted`.
 *
 * Per-line post amount:
 *   - VAT-active + vat_recoverable=true → line.subtotal (net of VAT)
 *   - VAT-active + vat_recoverable=false → line.total (gross)
 *   - VAT-inactive (Kraken) → line.total (gross)
 *
 * Required per line: project_id, cost_code_id. We refuse the whole receipt
 * otherwise and name the offending lines.
 */
export async function postReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canApproveReceipt(role)) {
    return {
      ok: false,
      error: 'Only owners or accounting can approve and post receipts.',
    };
  }
  // Dev-demo auth: the synthetic user id isn't in users — stamp audit FKs
  // only when the id really exists so the insert can't fail on the FK.
  const knownUsers = await getUserNamesByIds([user.id]);
  const auditUserId = knownUsers.has(user.id) ? user.id : null;
  const company = await getActiveCompany();
  const receipt = await getReceipt(company.id, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status === 'void') {
    return { ok: false, error: 'Receipt is void.' };
  }
  const lines = await listReceiptLines(company.id, receipt.id);
  // A line is "settled" once posted: job-cost lines carry a job-cost entry;
  // overhead lines (no project/cost code) never create one and post to the GL
  // only. Idempotent return once everything that should post has posted.
  const isSettled = (l: (typeof lines)[number]) =>
    !!l.postedJobCostEntryId || !(l.projectId && l.costCodeId);
  if (receipt.status === 'posted' && lines.every(isSettled)) {
    return { ok: true }; // idempotent — already posted
  }
  if (lines.length === 0) {
    return { ok: false, error: 'Add at least one line before posting.' };
  }

  const missing: number[] = [];
  const reimbursableMissingPayee: number[] = [];
  lines.forEach((l, idx) => {
    // Job-cost line (project + cost code) OR overhead line (accounting
    // category, no project). Incomplete only when it has neither.
    if (!(l.projectId && l.costCodeId) && !l.accountingAccountId) {
      missing.push(idx + 1);
    }
    if (l.isReimbursable && !l.paidByUserId) {
      reimbursableMissingPayee.push(idx + 1);
    }
  });
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Line ${missing.join(', ')}: add a project + cost code, or an accounting category, before posting.`,
    };
  }
  if (reimbursableMissingPayee.length > 0) {
    return {
      ok: false,
      error: `Line ${reimbursableMissingPayee.join(', ')}: pick who paid out of pocket before posting (reimbursable line).`,
    };
  }

  for (const line of lines) {
    if (line.postedJobCostEntryId) continue; // line already posted
    // Overhead line (no project/cost code): no job-cost entry — it posts to
    // the GL via its accounting category (syncReceiptGl below) and is picked
    // up in the P&L as an overhead receipt expense.
    if (!line.projectId || !line.costCodeId) continue;

    const total = Number(line.total);
    const subtotal = Number(line.subtotal);
    const postAmount =
      company.isVatActive && receipt.vatRecoverable ? subtotal : total;

    const costType =
      line.costType &&
      (costTypeValues as readonly string[]).includes(line.costType)
        ? (line.costType as (typeof costTypeValues)[number])
        : 'other';

    const lineLabel = line.description
      ? line.description.slice(0, 200)
      : receipt.notes
        ? receipt.notes.slice(0, 200)
        : '';
    const description = lineLabel
      ? `Receipt ${receipt.receiptDate}: ${lineLabel}`
      : `Receipt ${receipt.receiptDate}`;

    const entry = await createJobCostEntry({
      companyId: company.id,
      projectId: line.projectId!, // checked above
      costCodeId: line.costCodeId!,
      // Phase 2 accounting: propagate the operational category from the
      // receipt line into job_cost_entries so P&L can group by rollup_group
      // without re-joining through receipt_lines.
      accountingAccountId: line.accountingAccountId ?? null,
      source: 'receipt_import',
      sourceRefId: receipt.id,
      costType,
      entryDate: receipt.receiptDate,
      vendorId: receipt.vendorId,
      description,
      quantity: '1',
      unitCost: toMoneyString(postAmount),
      amount: toMoneyString(postAmount),
      isBillable: line.isBillable,
      markupPercent: null,
      burdenPercent: null,
      vendorInvoiceNumber: null,
      attachmentUrl: null,
      notes: line.description ?? receipt.notes,
      createdByUserId: auditUserId,
    });

    await updateReceiptLine(company.id, line.id, {
      postedJobCostEntryId: entry.id,
    });

    revalidatePath(`/job-costing/${line.projectId}`);
  }

  const now = new Date();
  await updateReceipt(company.id, receipt.id, {
    status: 'posted',
    postedAt: now,
    approvedAt: now,
    approvedByUserId: auditUserId,
    // Clear any prior rejection note — it shouldn't linger on a posted record.
    rejectionReason: null,
  });

  // Post the receipt to the GL (Dr expense + VAT Input / Cr AP). Best-effort.
  try {
    await syncReceiptGl(company.id, receipt.id);
  } catch {
    /* best-effort — Rebuild can resync */
  }

  revalidatePath('/banking/receipts');
  revalidatePath(`/banking/receipts/${receipt.id}`);
  return { ok: true };
}

/** Reverse a Post — soft-deletes every linked job_cost_entries row, clears
 *  each line's posted ref, flips the receipt back to draft. Approver-only:
 *  unposting is an accounting action, not a field-user undo. */
export async function unpostReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canApproveReceipt(role)) {
    return { ok: false, error: 'Only owners or accounting can unpost.' };
  }
  const companyId = await getActiveCompanyId();
  const receipt = await getReceipt(companyId, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status !== 'posted') {
    return { ok: false, error: 'Receipt is not posted.' };
  }
  const lines = await listReceiptLines(companyId, receipt.id);

  for (const line of lines) {
    if (line.postedJobCostEntryId) {
      await softDeleteJobCostEntry(companyId, line.postedJobCostEntryId);
      await updateReceiptLine(companyId, line.id, {
        postedJobCostEntryId: null,
      });
      if (line.projectId) {
        revalidatePath(`/job-costing/${line.projectId}`);
      }
    }
  }

  await updateReceipt(companyId, receipt.id, {
    status: 'draft',
    postedAt: null,
    // Clear the approval audit too — the receipt is effectively un-approved.
    approvedAt: null,
    approvedByUserId: null,
  });

  // Clear the receipt's GL entry now it's back to draft. Best-effort.
  try {
    await syncReceiptGl(companyId, receipt.id);
  } catch {
    /* best-effort */
  }

  revalidatePath('/banking/receipts');
  revalidatePath(`/banking/receipts/${receipt.id}`);
  return { ok: true };
}

export async function voidReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canApproveReceipt(role)) {
    return { ok: false, error: 'Only owners or accounting can void.' };
  }
  const companyId = await getActiveCompanyId();
  const receipt = await getReceipt(companyId, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status === 'posted') {
    return { ok: false, error: 'Unpost the receipt before voiding.' };
  }
  await updateReceipt(companyId, receipt.id, { status: 'void' });
  revalidatePath('/banking/receipts');
  revalidatePath(`/banking/receipts/${receipt.id}`);
  return { ok: true };
}

export async function deleteReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canApproveReceipt(role)) {
    return { ok: false, error: 'Only owners or accounting can delete.' };
  }
  const companyId = await getActiveCompanyId();
  const receipt = await getReceipt(companyId, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status === 'posted') {
    return { ok: false, error: 'Unpost the receipt before deleting.' };
  }
  await softDeleteReceipt(companyId, input.id);
  revalidatePath('/banking/receipts');
  return { ok: true };
}

// ===== Bulk import (Phase 2.5) =====

export type BulkImportResultRow = {
  fileName: string;
  receiptId?: string;
  error?: string;
};

export type BulkImportActionState = {
  results?: BulkImportResultRow[];
  formError?: string;
};

/**
 * Bulk-create one draft receipt per uploaded file. Each draft gets:
 *   - receiptDate = today (operator edits later)
 *   - currency = company default
 *   - one empty line ready for project / cost code / amount
 *   - the file attached as the receipt's first attachment
 *
 * Files are processed sequentially to keep load on the storage API
 * predictable. Per-file failures don't abort the batch — the action returns
 * a result row for every file so the operator knows what landed.
 */
export async function bulkCreateReceiptDraftsAction(
  _prev: BulkImportActionState,
  formData: FormData,
): Promise<BulkImportActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { formError: 'No permission to create receipts.' };
  }
  const company = await getActiveCompany();

  const files = formData
    .getAll('file')
    .filter((f): f is File => f instanceof File && f.size > 0);
  const refs = parseUploadRefs(formData);
  if (files.length === 0 && refs.length === 0) {
    return { formError: 'Choose one or more files to upload.' };
  }

  const today = new Date().toISOString().slice(0, 10);
  const results: BulkImportResultRow[] = [];

  // Direct-to-storage refs: blob already in the bucket — verify, then
  // create the draft receipt + line + attachment around it.
  for (const ref of refs) {
    const row: BulkImportResultRow = { fileName: ref.fileName };
    try {
      const verified = await verifyReceiptUploadRef(company.id, ref);
      if (!verified.ok) {
        row.error = verified.error;
        results.push(row);
        continue;
      }
      const receipt = await createReceipt({
        companyId: company.id,
        receiptDate: today,
        currency: company.defaultCurrency,
        paymentSourceType: 'cash',
        vatIncluded: true,
        vatRecoverable: true,
        vatRatePercent: company.isVatActive
          ? toPercentString(Number(company.vatRatePercent) || 0)
          : null,
        vatPeriodQuarter: company.isVatActive ? vatQuarterForDate(today) : null,
        subtotal: '0',
        vatAmount: '0',
        total: '0',
        uploadedByUserId: user.id,
      });
      await createReceiptLine({
        companyId: company.id,
        receiptId: receipt.id,
        sortOrder: 0,
        subtotal: '0',
        vatAmount: '0',
        total: '0',
        isBillable: false,
        isReimbursable: false,
      });
      await createReceiptAttachment({
        companyId: company.id,
        receiptId: receipt.id,
        storagePath: ref.storagePath,
        mimeType: verified.mimeType,
        byteSize: verified.byteSize,
        originalFilename: ref.fileName,
        kind:
          verified.mimeType === 'application/pdf'
            ? 'supplier_invoice'
            : 'receipt_image',
        uploadedByUserId: user.id,
      });
      row.receiptId = receipt.id;
    } catch (err) {
      row.error = err instanceof Error ? err.message : 'Upload failed.';
    }
    results.push(row);
  }

  for (const file of files) {
    const row: BulkImportResultRow = { fileName: file.name };
    try {
      if (file.size > MAX_RECEIPT_BYTES) {
        row.error = 'File too large.';
        results.push(row);
        continue;
      }
      const mime = (file.type || 'application/octet-stream').toLowerCase();
      if (!ALLOWED_RECEIPT_MIME.has(mime)) {
        row.error = `Unsupported file type (${file.type || 'unknown'}).`;
        results.push(row);
        continue;
      }

      const receipt = await createReceipt({
        companyId: company.id,
        receiptDate: today,
        currency: company.defaultCurrency,
        paymentSourceType: 'cash',
        vatIncluded: true,
        vatRecoverable: true,
        vatRatePercent: company.isVatActive
          ? toPercentString(Number(company.vatRatePercent) || 0)
          : null,
        vatPeriodQuarter: company.isVatActive ? vatQuarterForDate(today) : null,
        subtotal: '0',
        vatAmount: '0',
        total: '0',
        uploadedByUserId: user.id,
      });

      await createReceiptLine({
        companyId: company.id,
        receiptId: receipt.id,
        sortOrder: 0,
        subtotal: '0',
        vatAmount: '0',
        total: '0',
        isBillable: false,
        isReimbursable: false,
      });

      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await uploadReceiptFile({
        companyId: company.id,
        bytes,
        mimeType: mime,
        originalFileName: file.name,
      });
      await createReceiptAttachment({
        companyId: company.id,
        receiptId: receipt.id,
        storagePath: upload.storagePath,
        mimeType: mime,
        byteSize: file.size,
        originalFilename: file.name,
        kind: mime === 'application/pdf' ? 'supplier_invoice' : 'receipt_image',
        uploadedByUserId: user.id,
      });

      row.receiptId = receipt.id;
    } catch (err) {
      if (err instanceof ReceiptStorageNotConfiguredError) {
        row.error = err.message;
      } else {
        row.error = err instanceof Error ? err.message : 'Upload failed.';
      }
    }
    results.push(row);
  }

  revalidatePath('/banking/receipts');
  return { results };
}

// =====================================================================
// Scan-to-create (drag & drop on the New receipt page)
// =====================================================================
//
// One step instead of two: the operator drops a photo / PDF, the blob is
// already in storage (signed-URL direct upload), and this action creates
// the draft receipt WITH the attachment and — when Document AI is
// configured — OCR-prefilled vendor / date / total / VAT. The caller then
// navigates to the draft for review. Mirrors the per-page logic of the
// multi-receipt PDF splitter below, for a single file of any supported type.

export type ScanReceiptResult =
  | {
      ok: true;
      receiptId: string;
      ocrEnabled: boolean;
      vendorName?: string;
      vendorMatched: boolean;
      total?: number;
      receiptDate?: string;
    }
  | { ok: false; error: string };

export async function createReceiptFromScanAction(input: {
  ref: unknown;
}): Promise<ScanReceiptResult> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { ok: false, error: 'No permission to create receipts.' };
  }
  // Dev-demo auth uses a synthetic user id that isn't in the users table —
  // stamp uploaded-by only when the id really exists so the FK can't fail.
  const knownUsers = await getUserNamesByIds([user.id]);
  const uploadedByUserId = knownUsers.has(user.id) ? user.id : null;
  const refParse = directUploadRefSchema.safeParse(input.ref);
  if (!refParse.success) {
    return { ok: false, error: 'Invalid upload reference — retry the upload.' };
  }
  const ref = refParse.data;
  const company = await getActiveCompany();

  const verified = await verifyReceiptUploadRef(company.id, ref);
  if (!verified.ok) return { ok: false, error: verified.error };

  // OCR first so the draft lands prefilled. A scan failure never blocks
  // creation — worst case the operator types the fields like before.
  const ocrEnabled = isOcrConfigured();
  let extracted: OcrExtractResult = {};
  if (ocrEnabled) {
    try {
      const blob = await downloadReceiptBlob(ref.storagePath);
      if (blob) {
        extracted = await extractReceipt({
          bytes: blob.bytes,
          mimeType: verified.mimeType,
        });
      }
    } catch {
      extracted = {};
    }
  }

  let matchedVendorId: string | null = null;
  if (extracted.vendorName) {
    const vendors = await listVendors(company.id);
    const needle = extracted.vendorName.toLowerCase().trim();
    const hit =
      vendors.find((v) => v.name.toLowerCase() === needle) ??
      vendors.find((v) => v.name.toLowerCase().includes(needle)) ??
      vendors.find((v) => needle.includes(v.name.toLowerCase()));
    matchedVendorId = hit?.id ?? null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const receiptDate = extracted.receiptDate ?? today;
  const currency = (extracted.currency ?? company.defaultCurrency)
    .toUpperCase()
    .slice(0, 3);
  const vatRate =
    typeof extracted.vatRate === 'number' && Number.isFinite(extracted.vatRate)
      ? extracted.vatRate
      : company.isVatActive
        ? Number(company.vatRatePercent) || 0
        : 0;

  try {
    const receipt = await createReceipt({
      companyId: company.id,
      receiptDate,
      currency,
      paymentSourceType: 'cash',
      vatIncluded: true,
      vatRecoverable: true,
      vatRatePercent: vatRate > 0 ? toPercentString(vatRate) : null,
      vatPeriodQuarter: company.isVatActive
        ? vatQuarterForDate(receiptDate)
        : null,
      vendorId: matchedVendorId,
      subtotal: '0',
      vatAmount: '0',
      total: '0',
      uploadedByUserId,
    });

    const ocrTotal =
      extracted.total ??
      (extracted.subtotal !== undefined && extracted.vatAmount !== undefined
        ? extracted.subtotal + extracted.vatAmount
        : undefined);
    const round = (n: number) => Math.round(n * 100) / 100;
    const lineGross = ocrTotal && ocrTotal > 0 ? round(ocrTotal) : 0;
    const lineSub =
      lineGross > 0 && vatRate > 0
        ? round(lineGross / (1 + vatRate / 100))
        : lineGross;
    const lineVat = round(lineGross - lineSub);

    await createReceiptLine({
      companyId: company.id,
      receiptId: receipt.id,
      sortOrder: 0,
      description: extracted.vendorName ?? null,
      subtotal: toMoneyString(lineSub),
      vatAmount: toMoneyString(lineVat),
      total: toMoneyString(lineGross),
      vatRatePercent: vatRate > 0 ? toPercentString(vatRate) : null,
      isBillable: false,
      isReimbursable: false,
    });
    await recalcReceiptHeaderTotals(company.id, receipt.id);

    await createReceiptAttachment({
      companyId: company.id,
      receiptId: receipt.id,
      storagePath: ref.storagePath,
      mimeType: verified.mimeType,
      byteSize: verified.byteSize,
      originalFilename: ref.fileName,
      kind:
        verified.mimeType === 'application/pdf'
          ? 'supplier_invoice'
          : 'receipt_image',
      uploadedByUserId,
    });

    revalidatePath('/banking/receipts');
    revalidatePath(`/banking/receipts/${receipt.id}`);
    return {
      ok: true,
      receiptId: receipt.id,
      ocrEnabled,
      vendorName: extracted.vendorName,
      vendorMatched: matchedVendorId !== null,
      total: ocrTotal,
      receiptDate: extracted.receiptDate,
    };
  } catch (err) {
    if (err instanceof ReceiptStorageNotConfiguredError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create receipt.',
    };
  }
}

// Silence the helper-only import warnings.
void canView;
void can;


// =====================================================================
// Multi-receipt PDF splitter (Phase 2.7)
// =====================================================================
//
// Accept ONE PDF that contains multiple receipts (one per page) — common
// output of a flatbed scan-a-stack workflow. Split with pdf-lib into N
// single-page PDFs, then for each page:
//   1. Create a draft receipt with today's date.
//   2. Run Document AI extract on the page bytes (if OCR is configured).
//   3. Apply extracted vendor / date / total / VAT to the header + one
//      receipt line, mirroring applyExtractedToReceiptAction logic.
//   4. Upload the per-page PDF as the receipt's only attachment.
//
// Caps:
//   - File size cap inherits MAX_RECEIPT_BYTES (25 MB).
//   - Page cap of 25 per batch keeps runtime under typical platform
//     timeouts (Document AI ~3-5s per page). Larger PDFs return an
//     error asking the operator to split the source.
//
// Per-page failures don't abort the batch — every page produces a
// result row so the operator knows which drafts landed and which
// need a retry.

export type BulkPdfExtractResultRow = {
  pageNumber: number;
  receiptId?: string;
  vendorName?: string;
  total?: number;
  receiptDate?: string;
  error?: string;
};

export type BulkPdfExtractActionState = {
  results?: BulkPdfExtractResultRow[];
  formError?: string;
  pageCount?: number;
  ocrEnabled?: boolean;
};

const MAX_PAGES_PER_BATCH = 25;

export async function bulkExtractMultiReceiptPdfAction(
  _prev: BulkPdfExtractActionState,
  formData: FormData,
): Promise<BulkPdfExtractActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    return { formError: 'No permission to create receipts.' };
  }
  const company = await getActiveCompany();

  // Source PDF arrives either as a direct-to-storage ref (preferred — no
  // transport size cap) or as an inline File (legacy ≤4.5MB path).
  const refs = parseUploadRefs(formData);
  const sourceRef = refs[0];
  let pdfBytes: Uint8Array;
  let sourceName: string;
  // Temp blob to delete once split succeeds — the per-page PDFs become the
  // receipts' attachments; the full source isn't kept (matches the legacy
  // inline path, which never stored the source either).
  let tempSourcePath: string | null = null;

  if (sourceRef) {
    const verified = await verifyReceiptUploadRef(company.id, sourceRef);
    if (!verified.ok) {
      return { formError: `${sourceRef.fileName}: ${verified.error}` };
    }
    if (verified.mimeType !== 'application/pdf') {
      return { formError: 'Multi-receipt extraction only supports PDF files.' };
    }
    const blob = await downloadReceiptBlob(sourceRef.storagePath);
    if (!blob) {
      return { formError: 'Could not read the uploaded PDF from storage — retry.' };
    }
    pdfBytes = blob.bytes;
    sourceName = sourceRef.fileName;
    tempSourcePath = sourceRef.storagePath;
  } else {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { formError: 'Choose a PDF to upload.' };
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      return { formError: 'PDF too large (max 25 MB).' };
    }
    const mime = (file.type || 'application/octet-stream').toLowerCase();
    if (mime !== 'application/pdf') {
      return { formError: 'Multi-receipt extraction only supports PDF files.' };
    }
    pdfBytes = new Uint8Array(await file.arrayBuffer());
    sourceName = file.name;
  }

  // Early returns must not leave the direct-uploaded temp source behind.
  const cleanupTempSource = async () => {
    if (tempSourcePath) {
      await removeStorageObject(RECEIPT_FILES_BUCKET, tempSourcePath);
    }
  };

  // Lazy-load pdf-lib to keep the module graph trim — it's only needed
  // when this action actually fires.
  const { PDFDocument } = await import('pdf-lib');
  let sourceDoc;
  try {
    sourceDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (err) {
    await cleanupTempSource();
    return {
      formError:
        err instanceof Error
          ? `Could not read PDF: ${err.message}`
          : 'Could not read PDF.',
    };
  }
  const totalPages = sourceDoc.getPageCount();
  if (totalPages === 0) {
    await cleanupTempSource();
    return { formError: 'PDF has no pages.' };
  }
  if (totalPages > MAX_PAGES_PER_BATCH) {
    await cleanupTempSource();
    return {
      formError: `PDF has ${totalPages} pages — split into batches of ${MAX_PAGES_PER_BATCH} or fewer and re-upload.`,
      pageCount: totalPages,
    };
  }

  const ocrEnabled = isOcrConfigured();
  const today = new Date().toISOString().slice(0, 10);
  const vendors = ocrEnabled ? await listVendors(company.id) : [];
  const baseName = sourceName.replace(/\.pdf$/i, '');

  const results: BulkPdfExtractResultRow[] = [];

  for (let i = 0; i < totalPages; i++) {
    const pageNumber = i + 1;
    const row: BulkPdfExtractResultRow = { pageNumber };
    try {
      // Build a single-page PDF for this page so each draft gets a
      // standalone attachment.
      const pageDoc = await PDFDocument.create();
      const [copied] = await pageDoc.copyPages(sourceDoc, [i]);
      pageDoc.addPage(copied);
      const pageBytes = await pageDoc.save();

      // OCR first — we want to know vendor/date so the draft lands
      // pre-filled where possible.
      let extracted: OcrExtractResult = {};
      if (ocrEnabled) {
        try {
          extracted = await extractReceipt({
            bytes: pageBytes,
            mimeType: 'application/pdf',
          });
        } catch (err) {
          // OCR failure shouldn't kill the page — fall through and
          // still create the draft, just without extraction.
          row.error =
            err instanceof Error
              ? `OCR failed: ${err.message}`
              : 'OCR failed.';
        }
      }

      // Match an existing vendor on name when possible.
      let matchedVendorId: string | null = null;
      if (extracted.vendorName && vendors.length > 0) {
        const needle = extracted.vendorName.toLowerCase().trim();
        const hit =
          vendors.find((v) => v.name.toLowerCase() === needle) ??
          vendors.find((v) => v.name.toLowerCase().includes(needle)) ??
          vendors.find((v) => needle.includes(v.name.toLowerCase()));
        matchedVendorId = hit?.id ?? null;
      }

      const receiptDate = extracted.receiptDate ?? today;
      const currency = (extracted.currency ?? company.defaultCurrency)
        .toUpperCase()
        .slice(0, 3);
      const vatRate =
        typeof extracted.vatRate === 'number' && Number.isFinite(extracted.vatRate)
          ? extracted.vatRate
          : company.isVatActive
            ? Number(company.vatRatePercent) || 0
            : 0;

      const receipt = await createReceipt({
        companyId: company.id,
        receiptDate,
        currency,
        paymentSourceType: 'cash',
        vatIncluded: true,
        vatRecoverable: true,
        vatRatePercent: vatRate > 0 ? toPercentString(vatRate) : null,
        vatPeriodQuarter: company.isVatActive
          ? vatQuarterForDate(receiptDate)
          : null,
        vendorId: matchedVendorId,
        subtotal: '0',
        vatAmount: '0',
        total: '0',
        uploadedByUserId: user.id,
      });

      // Build the single line. Prefer per-receipt total from OCR; fall
      // back to subtotal+vat when only those are present; otherwise an
      // empty $0 line for the operator to edit.
      const ocrTotal =
        extracted.total ??
        (extracted.subtotal !== undefined && extracted.vatAmount !== undefined
          ? extracted.subtotal + extracted.vatAmount
          : undefined);
      const round = (n: number) => Math.round(n * 100) / 100;
      const lineGross = ocrTotal && ocrTotal > 0 ? round(ocrTotal) : 0;
      const lineSub =
        lineGross > 0 && vatRate > 0
          ? round(lineGross / (1 + vatRate / 100))
          : lineGross;
      const lineVat = round(lineGross - lineSub);

      await createReceiptLine({
        companyId: company.id,
        receiptId: receipt.id,
        sortOrder: 0,
        description: extracted.vendorName
          ? `${extracted.vendorName} (page ${pageNumber})`
          : null,
        subtotal: toMoneyString(lineSub),
        vatAmount: toMoneyString(lineVat),
        total: toMoneyString(lineGross),
        vatRatePercent: vatRate > 0 ? toPercentString(vatRate) : null,
        isBillable: false,
        isReimbursable: false,
      });
      await recalcReceiptHeaderTotals(company.id, receipt.id);

      // Attach the single-page PDF so the operator can verify what was
      // extracted against the source page.
      const upload = await uploadReceiptFile({
        companyId: company.id,
        bytes: pageBytes,
        mimeType: 'application/pdf',
        originalFileName: `${baseName}-page-${pageNumber}.pdf`,
      });
      await createReceiptAttachment({
        companyId: company.id,
        receiptId: receipt.id,
        storagePath: upload.storagePath,
        mimeType: 'application/pdf',
        byteSize: pageBytes.byteLength,
        originalFilename: `${baseName}-page-${pageNumber}.pdf`,
        kind: 'supplier_invoice',
        uploadedByUserId: user.id,
      });

      row.receiptId = receipt.id;
      row.vendorName = extracted.vendorName;
      row.total = ocrTotal;
      row.receiptDate = extracted.receiptDate;
      // Clear any soft OCR error we noted earlier — the draft still
      // landed successfully, so don't surface OCR-only failures as
      // hard errors at the row level.
      row.error = undefined;
    } catch (err) {
      row.error =
        err instanceof Error ? err.message : 'Failed to process page.';
    }
    results.push(row);
  }

  // The per-page PDFs are now the receipts' attachments — drop the temp
  // full-source blob from the direct-upload path.
  await cleanupTempSource();

  revalidatePath('/banking/receipts');
  return { results, pageCount: totalPages, ocrEnabled };
}
