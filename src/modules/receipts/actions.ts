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
import { can, canCreate, canView } from '@/lib/permissions';
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
  getReceipt,
  listReceiptAttachments,
  softDeleteReceipt,
  softDeleteReceiptAttachment,
  updateReceipt,
} from '@/lib/data/receipts';
import {
  createJobCostEntry,
  softDeleteJobCostEntry,
} from '@/lib/data/job-cost-entries';
import { upsertReceiptSchema, costTypeValues } from './schema';
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
  const parsed = upsertReceiptSchema.safeParse({
    id: (formData.get('id') as string) || undefined,
    receiptDate: formData.get('receiptDate') ?? '',
    vendorId: formData.get('vendorId') ?? '',
    projectId: formData.get('projectId') ?? '',
    costCodeId: formData.get('costCodeId') ?? '',
    accountingAccountId: formData.get('accountingAccountId') ?? '',
    bankAccountId: formData.get('bankAccountId') ?? '',
    paymentSourceType: formData.get('paymentSourceType') ?? 'cash',
    currency: formData.get('currency') ?? company.defaultCurrency,
    subtotal: formData.get('subtotal') ?? '0',
    vatAmount: formData.get('vatAmount') ?? '0',
    total: formData.get('total') ?? '0',
    vatRatePercent: formData.get('vatRatePercent') ?? '',
    vatIncluded:
      formData.get('vatIncluded') === 'on' ||
      formData.get('vatIncluded') === 'true',
    vatRecoverable:
      formData.get('vatRecoverable') === 'on' ||
      formData.get('vatRecoverable') === 'true',
    vendorTin: formData.get('vendorTin') ?? '',
    costType: formData.get('costType') ?? '',
    isBillable:
      formData.get('isBillable') === 'on' ||
      formData.get('isBillable') === 'true',
    isReimbursable:
      formData.get('isReimbursable') === 'on' ||
      formData.get('isReimbursable') === 'true',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return {
      formError: 'Fix the highlighted fields.',
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  // Server-side recompute of VAT triplet to guarantee subtotal+vat=total even
  // if the client form went out of sync. Defaults to 'init' driver — leaves
  // existing typed values alone where possible.
  const computed = company.isVatActive
    ? computeVat({
        subtotal: d.subtotal,
        vatAmount: d.vatAmount,
        total: d.total,
        vatRatePercent: d.vatRatePercent ?? 0,
        vatIncluded: d.vatIncluded ?? true,
        driver: 'init',
      })
    : {
        subtotal: d.total > 0 ? d.total : d.subtotal,
        vatAmount: 0,
        total: d.total > 0 ? d.total : d.subtotal,
        vatRatePercent: 0,
      };

  const values = {
    companyId: company.id,
    projectId: d.projectId,
    costCodeId: d.costCodeId,
    vendorId: d.vendorId,
    accountingAccountId: d.accountingAccountId,
    paymentSourceType: d.paymentSourceType,
    bankAccountId: d.paymentSourceType === 'bank' || d.paymentSourceType === 'credit_card' ? d.bankAccountId : null,
    receiptDate: d.receiptDate,
    currency: d.currency,
    subtotal: toMoneyString(computed.subtotal),
    vatAmount: toMoneyString(computed.vatAmount),
    total: toMoneyString(computed.total),
    vatRatePercent:
      d.vatRatePercent === null
        ? null
        : toPercentString(d.vatRatePercent),
    vatIncluded: d.vatIncluded ?? true,
    vatRecoverable: d.vatRecoverable ?? true,
    vatPeriodQuarter: company.isVatActive
      ? vatQuarterForDate(d.receiptDate)
      : null,
    vendorTin: d.vendorTin,
    costType: d.costType,
    isBillable: d.isBillable ?? false,
    isReimbursable: d.isReimbursable ?? false,
    notes: d.notes,
    uploadedByUserId: user.id,
  } as const;

  if (d.id) {
    // Refuse edit on a posted receipt — operator must Unpost first.
    const existing = await getReceipt(company.id, d.id);
    if (!existing) return { formError: 'Receipt not found.' };
    if (existing.status === 'posted') {
      return {
        formError:
          'This receipt is posted. Unpost it first if you need to edit.',
      };
    }
    await updateReceipt(company.id, d.id, values);
    revalidatePath('/banking/receipts');
    revalidatePath(`/banking/receipts/${d.id}`);
    return { ok: true, receiptId: d.id };
  }
  const created = await createReceipt(values);
  revalidatePath('/banking/receipts');
  redirect(`/banking/receipts/${created.id}` as never);
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
  // Find the attachment to grab its storage path before soft-delete.
  const attachments = await listReceiptAttachments(companyId, input.receiptId);
  const target = attachments.find((a) => a.id === input.attachmentId);
  if (!target) return { ok: false, error: 'Attachment not found.' };
  await softDeleteReceiptAttachment(companyId, input.attachmentId);
  // Best-effort blob cleanup. Orphaned blobs are harmless.
  try {
    await deleteReceiptBlob(target.storagePath);
  } catch {
    /* swallow */
  }
  revalidatePath(`/banking/receipts/${input.receiptId}`);
  return { ok: true };
}

// ===== Post / Unpost =====

/**
 * Post a draft receipt → creates exactly one job_cost_entries row, 1:1, with
 * source='receipt_import' and source_ref_id=receipts.id. Idempotent: a second
 * call on an already-posted receipt is a no-op.
 *
 * Amount written:
 *   - VAT-active + vat_recoverable=true → subtotal (net of VAT). VAT accrues
 *     to the VAT Input account elsewhere; it does NOT post to job_cost_entries.
 *   - VAT-active + vat_recoverable=false → total (gross). VAT is part of the
 *     project's cost.
 *   - VAT-inactive (Kraken) → total (gross). VAT is moot.
 *
 * Required to post: project_id, cost_code_id. We refuse otherwise.
 */
export async function postReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts') || role === 'field_user') {
    // Field users can upload receipts but cannot post them — posting is
    // accounting/PM/owner territory.
    return { ok: false, error: 'No permission to post receipts.' };
  }
  const company = await getActiveCompany();
  const receipt = await getReceipt(company.id, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status === 'void') {
    return { ok: false, error: 'Receipt is void.' };
  }
  if (receipt.status === 'posted' && receipt.postedJobCostEntryId) {
    return { ok: true }; // idempotent
  }
  if (!receipt.projectId) {
    return { ok: false, error: 'Project is required before posting.' };
  }
  if (!receipt.costCodeId) {
    return { ok: false, error: 'Cost code is required before posting.' };
  }

  // Decide the amount.
  const total = Number(receipt.total);
  const subtotal = Number(receipt.subtotal);
  const postAmount =
    company.isVatActive && receipt.vatRecoverable ? subtotal : total;

  // Validate cost_type. Falls back to 'other' if the operator left it blank.
  const costType =
    receipt.costType &&
    (costTypeValues as readonly string[]).includes(receipt.costType)
      ? (receipt.costType as (typeof costTypeValues)[number])
      : 'other';

  const description =
    receipt.notes && receipt.notes.length > 0
      ? `Receipt ${receipt.receiptDate}: ${receipt.notes.slice(0, 200)}`
      : `Receipt ${receipt.receiptDate}`;

  // We don't have a transactional wrapper across both data modules — create
  // the entry, then update the receipt. If the second write fails, the
  // entry exists but the receipt remains draft and the operator sees the
  // error. Unposting will not find a posted_job_cost_entry_id to remove,
  // so a manual cleanup may be needed. Failure here is rare (single row
  // update) and recoverable.
  const entry = await createJobCostEntry({
    companyId: company.id,
    projectId: receipt.projectId,
    costCodeId: receipt.costCodeId,
    source: 'receipt_import',
    sourceRefId: receipt.id,
    costType,
    entryDate: receipt.receiptDate,
    vendorId: receipt.vendorId,
    description,
    quantity: '1',
    unitCost: toMoneyString(postAmount),
    amount: toMoneyString(postAmount),
    isBillable: receipt.isBillable,
    markupPercent: null,
    burdenPercent: null,
    vendorInvoiceNumber: null,
    attachmentUrl: null,
    notes: receipt.notes,
    createdByUserId: user.id,
  });

  await updateReceipt(company.id, receipt.id, {
    status: 'posted',
    postedAt: new Date(),
    postedJobCostEntryId: entry.id,
  });

  revalidatePath('/banking/receipts');
  revalidatePath(`/banking/receipts/${receipt.id}`);
  revalidatePath(`/job-costing/${receipt.projectId}`);
  return { ok: true };
}

/** Reverse a Post — soft-deletes the linked job_cost_entries row, flips the
 *  receipt back to draft. Refused on a non-posted receipt or one whose entry
 *  link is missing. */
export async function unpostReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'receipts', 'create')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const receipt = await getReceipt(companyId, input.id);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status !== 'posted' || !receipt.postedJobCostEntryId) {
    return { ok: false, error: 'Receipt is not posted.' };
  }
  await softDeleteJobCostEntry(companyId, receipt.postedJobCostEntryId);
  await updateReceipt(companyId, receipt.id, {
    status: 'draft',
    postedAt: null,
    postedJobCostEntryId: null,
  });
  revalidatePath('/banking/receipts');
  revalidatePath(`/banking/receipts/${receipt.id}`);
  if (receipt.projectId) {
    revalidatePath(`/job-costing/${receipt.projectId}`);
  }
  return { ok: true };
}

export async function voidReceiptAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'receipts', 'create')) {
    return { ok: false, error: 'No permission.' };
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
  if (!can(role, 'receipts', 'create')) {
    return { ok: false, error: 'No permission.' };
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

// Silence the helper-only import warning.
void canView;
