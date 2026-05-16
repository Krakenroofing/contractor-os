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
  ReceiptStorageNotConfiguredError,
  uploadReceiptFile,
  deleteReceiptBlob,
} from '@/lib/storage/receipt-files';
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
 *  insert new, soft-delete any persisted line whose id is no longer present. */
async function replaceReceiptLines(
  companyId: string,
  receiptId: string,
  inputs: Array<{
    line: UpsertReceiptLineInput;
    computed: { subtotal: number; vatAmount: number; total: number; vatRatePercent: number };
    sortOrder: number;
  }>,
) {
  const existing = await listReceiptLines(companyId, receiptId);
  const existingById = new Map(existing.map((l) => [l.id, l]));
  const seenIds = new Set<string>();

  for (const { line, computed, sortOrder } of inputs) {
    const values = {
      sortOrder,
      projectId: line.projectId,
      costCodeId: line.costCodeId,
      accountingAccountId: line.accountingAccountId,
      costType: line.costType,
      description: line.description,
      subtotal: toMoneyString(computed.subtotal),
      vatAmount: toMoneyString(computed.vatAmount),
      total: toMoneyString(computed.total),
      vatRatePercent:
        line.vatRatePercent === null
          ? null
          : toPercentString(line.vatRatePercent),
      isBillable: line.isBillable ?? false,
      isReimbursable: line.isReimbursable ?? false,
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

  // Soft-delete any persisted line that the form removed.
  for (const e of existing) {
    if (!seenIds.has(e.id)) {
      await softDeleteReceiptLine(companyId, e.id);
    }
  }
}

// ===== File attachments =====

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
  if (files.length === 0) return { formError: 'Choose a file to upload.' };

  const failures: string[] = [];
  let okCount = 0;
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
        uploadedByUserId: user.id,
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
  lines.forEach((l, idx) => {
    if (!l.projectId || !l.costCodeId) missing.push(idx + 1);
  });
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Line ${missing.join(', ')}: project and cost code are required before submitting.`,
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
  const company = await getActiveCompany();
  const receipt = await getReceipt(company.id, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status === 'void') {
    return { ok: false, error: 'Receipt is void.' };
  }
  const lines = await listReceiptLines(company.id, receipt.id);
  if (receipt.status === 'posted' && lines.every((l) => l.postedJobCostEntryId)) {
    return { ok: true }; // idempotent — every line already posted
  }
  if (lines.length === 0) {
    return { ok: false, error: 'Add at least one line before posting.' };
  }

  const missing: number[] = [];
  lines.forEach((l, idx) => {
    if (!l.projectId || !l.costCodeId) missing.push(idx + 1);
  });
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Line ${missing.join(', ')}: project and cost code are required before posting.`,
    };
  }

  for (const line of lines) {
    if (line.postedJobCostEntryId) continue; // line already posted

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
      createdByUserId: user.id,
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
    approvedByUserId: user.id,
    // Clear any prior rejection note — it shouldn't linger on a posted record.
    rejectionReason: null,
  });

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

// Silence the helper-only import warnings.
void canView;
void can;
