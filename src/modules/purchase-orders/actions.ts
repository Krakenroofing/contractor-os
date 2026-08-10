'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate, ROLE_LABELS } from '@/lib/permissions';
import { appendActivity } from '@/lib/mock-store';
import {
  calcPOTotals,
  multiply,
  toMoneyString,
  toPercentString,
  toQuantityString,
} from '@/lib/money';
import {
  createPurchaseOrder,
  DuplicatePONumberError,
  getPurchaseOrder,
  getPurchaseOrderLines,
  renamePurchaseOrder,
  setPurchaseOrderVendorInvoiceNumber,
  updatePurchaseOrderHeader,
} from '@/lib/data/purchase-orders';
import {
  createReceipt,
  createReceiptLine,
  recalcReceiptHeaderTotals,
} from '@/lib/data/receipts';
import { getVendor } from '@/lib/data/vendors';
import { computeVat, vatQuarterForDate } from '@/modules/receipts/lib/vat';
import {
  createPoReceipt,
  deletePoReceipt,
} from '@/lib/data/po-receipts';
import { getDefaultLocation } from '@/lib/data/inventory-locations';
import { createProjectDocument } from '@/lib/data/project-documents';
import { getProject } from '@/lib/data/projects';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import {
  extractPurchaseOrderFromPdf,
  isOcrConfigured,
  type ExtractedPo,
} from '@/lib/ocr/po-extract';
import {
  diagnoseDocumentAi,
  type DocumentAiDiagnosis,
} from '@/lib/ocr/document-ai';
import {
  ALLOWED_RECEIPT_MIME,
  MAX_RECEIPT_BYTES,
  RECEIPT_FILES_BUCKET,
  deleteReceiptBlob,
  downloadReceiptBlob,
  uploadReceiptFile,
} from '@/lib/storage/receipt-files';
import { statStorageObject } from '@/lib/storage/signed-upload';
import { uploadProjectDocument } from '@/lib/storage/project-documents';
import {
  createPoFromExtractedSchema,
  poReceiptFormSchema,
  purchaseOrderFormSchema,
} from './schema';

export type CreatePurchaseOrderState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type UpdatePurchaseOrderHeaderState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createPurchaseOrderAction(
  _prev: CreatePurchaseOrderState,
  formData: FormData,
): Promise<CreatePurchaseOrderState> {
  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read line items.' };
  }

  const parsed = purchaseOrderFormSchema.safeParse({
    number: formData.get('number'),
    projectId: formData.get('projectId'),
    vendorId: formData.get('vendorId'),
    landedCostEntryId: formData.get('landedCostEntryId') ?? '',
    status: formData.get('status') ?? 'draft',
    issueDate: formData.get('issueDate') ?? '',
    expectedDeliveryDate: formData.get('expectedDeliveryDate') ?? '',
    taxAmount: formData.get('taxAmount') ?? '0',
    shipping: formData.get('shipping') ?? '0',
    notes: formData.get('notes') ?? '',
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;

  const numericLines = data.lines.map((l) => ({
    quantityOrdered: Number(l.quantity),
    unitCost: Number(l.unitCost),
  }));
  const totals = calcPOTotals({
    lines: numericLines,
    taxAmount: Number(data.taxAmount),
    shipping: Number(data.shipping),
  });

  const persistLines = data.lines.map((l, i) => ({
    costCodeId: l.costCodeId,
    inventoryItemId: emptyToNull(l.inventoryItemId ?? null),
    description: l.description,
    unit: emptyToNull(l.unit ?? null),
    quantityOrdered: toQuantityString(numericLines[i].quantityOrdered),
    unitCost: toQuantityString(numericLines[i].unitCost),
    lineTotal: toMoneyString(multiply(numericLines[i].quantityOrdered, numericLines[i].unitCost)),
  }));

  const companyId = await getActiveCompanyId();
  let createdId: string;
  try {
    const po = await createPurchaseOrder(companyId, {
      number: data.number,
      projectId: data.projectId,
      vendorId: data.vendorId,
      landedCostEntryId: emptyToNull(data.landedCostEntryId ?? null),
      status: data.status,
      issueDate: emptyToNull(data.issueDate ?? null),
      expectedDeliveryDate: emptyToNull(data.expectedDeliveryDate ?? null),
      notes: emptyToNull(data.notes ?? null),
      subtotal: toMoneyString(totals.subtotal),
      taxAmount: toMoneyString(totals.taxAmount),
      shipping: toMoneyString(totals.shipping),
      total: toMoneyString(totals.total),
      lines: persistLines,
    });
    createdId = po.id;
  } catch (err) {
    if (err instanceof DuplicatePONumberError) {
      return { errors: { number: ['That PO number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create purchase order: ${message}` };
  }

  revalidatePath('/purchase-orders');
  redirect(`/purchase-orders/${createdId}`);
}

const headerUpdateSchema = z.object({
  id: z.string().uuid('Missing or invalid id'),
  issueDate: z.string().optional().or(z.literal('')),
  expectedDeliveryDate: z.string().optional().or(z.literal('')),
  shipToAddressLine1: z.string().max(200).optional().or(z.literal('')),
  shipToCity: z.string().max(100).optional().or(z.literal('')),
  shipToState: z.string().max(100).optional().or(z.literal('')),
  shipToPostalCode: z.string().max(20).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function updatePurchaseOrderHeaderAction(
  _prev: UpdatePurchaseOrderHeaderState,
  formData: FormData,
): Promise<UpdatePurchaseOrderHeaderState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { formError: 'You do not have permission to edit purchase orders.' };
  }

  const parsed = headerUpdateSchema.safeParse({
    id: formData.get('id'),
    issueDate: formData.get('issueDate') ?? '',
    expectedDeliveryDate: formData.get('expectedDeliveryDate') ?? '',
    shipToAddressLine1: formData.get('shipToAddressLine1') ?? '',
    shipToCity: formData.get('shipToCity') ?? '',
    shipToState: formData.get('shipToState') ?? '',
    shipToPostalCode: formData.get('shipToPostalCode') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const existing = await getPurchaseOrder(companyId, parsed.data.id);
  if (!existing) {
    return { formError: 'Purchase order not found.' };
  }
  // Once issued, the PO is committed cost — receipts and job costing roll
  // up against its lines and totals. Refuse header edits past draft to
  // avoid silently changing the order vendors and accounting see.
  if (existing.status !== 'draft') {
    return {
      formError: `PO is in status "${existing.status}" — only drafts can be edited.`,
    };
  }

  try {
    const updated = await updatePurchaseOrderHeader(companyId, parsed.data.id, {
      issueDate: emptyToNull(parsed.data.issueDate ?? null),
      expectedDeliveryDate: emptyToNull(
        parsed.data.expectedDeliveryDate ?? null,
      ),
      shipToAddressLine1: emptyToNull(parsed.data.shipToAddressLine1 ?? null),
      shipToCity: emptyToNull(parsed.data.shipToCity ?? null),
      shipToState: emptyToNull(parsed.data.shipToState ?? null),
      shipToPostalCode: emptyToNull(parsed.data.shipToPostalCode ?? null),
      notes: emptyToNull(parsed.data.notes ?? null),
    });
    if (!updated) return { formError: 'PO not found in active company.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save purchase order: ${message}` };
  }

  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${parsed.data.id}`);
  if (existing.projectId) revalidatePath(`/projects/${existing.projectId}`);
  redirect(`/purchase-orders/${parsed.data.id}`);
}

// ===== Rename (number only) =====

const renameSchema = z.object({
  id: z.string().uuid('Missing or invalid id'),
  number: z.string().trim().min(1, 'PO number is required').max(50),
});

/**
 * Change a PO's human-facing number in any status (typo fixes like
 * PO012 → PO0012). Everything references the PO by id, so this is cosmetic —
 * but the new number must still be unique within the company.
 */
export async function renamePurchaseOrderAction(input: {
  id: string;
  number: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { ok: false, error: 'You do not have permission to edit purchase orders.' };
  }

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.flatten().fieldErrors.number?.[0] ?? 'Invalid PO number.',
    };
  }

  const companyId = await getActiveCompanyId();
  const existing = await getPurchaseOrder(companyId, parsed.data.id);
  if (!existing) {
    return { ok: false, error: 'Purchase order not found.' };
  }
  if (existing.number === parsed.data.number) {
    return { ok: true };
  }

  try {
    const updated = await renamePurchaseOrder(
      companyId,
      parsed.data.id,
      parsed.data.number,
    );
    if (!updated) return { ok: false, error: 'PO not found in active company.' };
  } catch (err) {
    if (err instanceof DuplicatePONumberError) {
      return { ok: false, error: 'That PO number is already used.' };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Failed to rename purchase order: ${message}` };
  }

  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${parsed.data.id}`);
  if (existing.projectId) revalidatePath(`/projects/${existing.projectId}`);
  return { ok: true };
}

// Record the supplier's own invoice number on a PO — works in any status
// (the vendor bill shows up long after issue). Empty string clears it.
export async function setVendorInvoiceNumberAction(input: {
  id: string;
  vendorInvoiceNumber: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { ok: false, error: 'You do not have permission to edit purchase orders.' };
  }
  const parsed = z
    .object({
      id: z.string().uuid(),
      vendorInvoiceNumber: z.string().trim().max(100),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid invoice number.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const updated = await setPurchaseOrderVendorInvoiceNumber(
      companyId,
      parsed.data.id,
      parsed.data.vendorInvoiceNumber === ''
        ? null
        : parsed.data.vendorInvoiceNumber,
    );
    if (!updated) return { ok: false, error: 'PO not found in active company.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Failed to save invoice number: ${message}` };
  }
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${parsed.data.id}`);
  revalidatePath('/reports/accounts-payable');
  return { ok: true };
}

// ===== Receiving (Phase 6.1) =====

export type RecordPoReceiptState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function revalidatePOPaths(poId: string, projectId: string | null) {
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath(`/purchase-orders/${poId}/receive`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath('/dashboard');
}

export async function recordPoReceiptAction(
  _prev: RecordPoReceiptState,
  formData: FormData,
): Promise<RecordPoReceiptState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { formError: 'You do not have permission to receive purchase orders.' };
  }

  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read receipt lines.' };
  }

  const parsed = poReceiptFormSchema.safeParse({
    purchaseOrderId: formData.get('purchaseOrderId'),
    receivedDate: formData.get('receivedDate'),
    notes: formData.get('notes') ?? '',
    locationId: formData.get('locationId') ?? '',
    lines: parsedLines,
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const lines = parsed.data.lines
    .map((l) => ({
      poLineId: l.poLineId,
      quantityReceived: Number(l.quantityReceived || '0'),
    }))
    .filter((l) => l.quantityReceived > 0);

  if (lines.length === 0) {
    return { formError: 'Enter a quantity received on at least one line.' };
  }

  const companyId = await getActiveCompanyId();
  const po = await getPurchaseOrder(companyId, parsed.data.purchaseOrderId);
  if (!po) {
    return { formError: 'Purchase order not found.' };
  }

  // Treat the entered date as noon local time so it sits inside the chosen
  // day regardless of which timezone the row is later rendered in.
  const receivedAt = new Date(`${parsed.data.receivedDate}T12:00:00`);

  // Resolve location: prefer explicit pick, fall back to company default.
  // Mirrors the adjustment action's resolution path so the two flows
  // behave consistently when the form leaves it blank.
  let locationId: string | null =
    parsed.data.locationId && parsed.data.locationId !== ''
      ? parsed.data.locationId
      : null;
  if (!locationId) {
    const def = await getDefaultLocation(companyId);
    if (!def) {
      return {
        formError:
          'No default stock location is configured. Visit /inventory/locations to create one before receiving against this PO.',
      };
    }
    locationId = def.id;
  }

  let resultingStatus: string;
  try {
    const result = await createPoReceipt(companyId, po.id, {
      receivedAt,
      receivedByUserId: user.id,
      notes: parsed.data.notes?.trim() || null,
      locationId,
      lines,
    });
    resultingStatus = result.resultingStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to record receipt: ${message}` };
  }

  const totalQty = lines.reduce((acc, l) => acc + l.quantityReceived, 0);
  appendActivity(companyId, {
    entityType: 'purchase_order',
    entityId: po.id,
    kind: 'po_receipt_recorded',
    summary: `Received ${totalQty.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })} unit${totalQty === 1 ? '' : 's'} across ${lines.length} line${
      lines.length === 1 ? '' : 's'
    } — PO now ${resultingStatus.replace('_', ' ')}`,
    actorRole: ROLE_LABELS[role],
  });

  revalidatePOPaths(po.id, po.projectId);
  redirect(`/purchase-orders/${po.id}`);
}

const deleteReceiptSchema = z.object({
  receiptId: z.string().uuid('Invalid receipt id'),
  purchaseOrderId: z.string().uuid('Invalid PO id'),
});

export type DeletePoReceiptState = {
  formError?: string;
};

export async function deletePoReceiptAction(
  _prev: DeletePoReceiptState,
  formData: FormData,
): Promise<DeletePoReceiptState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { formError: 'You do not have permission to undo receipts.' };
  }

  const parsed = deleteReceiptSchema.safeParse({
    receiptId: formData.get('receiptId'),
    purchaseOrderId: formData.get('purchaseOrderId'),
  });
  if (!parsed.success) {
    return { formError: 'Invalid receipt reference.' };
  }

  const companyId = await getActiveCompanyId();
  const po = await getPurchaseOrder(companyId, parsed.data.purchaseOrderId);
  if (!po) {
    return { formError: 'Purchase order not found.' };
  }

  try {
    const result = await deletePoReceipt(companyId, parsed.data.receiptId);
    appendActivity(companyId, {
      entityType: 'purchase_order',
      entityId: po.id,
      kind: 'po_receipt_deleted',
      summary: `Receipt reversed — PO now ${result.resultingStatus.replace('_', ' ')}`,
      actorRole: ROLE_LABELS[role],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to undo receipt: ${message}` };
  }

  revalidatePOPaths(po.id, po.projectId);
  return {};
}

// ===== Create bill (AP) from a PO =====
//
// Copies a purchase order onto a draft Bill (a receipt — bills and receipts
// share the same AP table). Each PO line becomes a receipt line carrying its
// project, cost code, description and net cost; VAT is layered on top using
// the company rate (PO line totals are net of tax). The draft lands in
// /banking/receipts where the operator reviews and Posts it — Post books the
// expense to job costing AND the GL (Dr Expense / Cr Accounts Payable), so it
// hits the income statement as a cost owed but not yet paid.

export type CreateBillFromPoState = {
  formError?: string;
};

export async function createBillFromPoAction(
  _prev: CreateBillFromPoState,
  formData: FormData,
): Promise<CreateBillFromPoState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  // Creating the bill writes to the receipts/AP ledger — gate on that
  // permission, not purchase_orders.
  if (!canCreate(role, 'receipts')) {
    return { formError: 'You do not have permission to create bills.' };
  }

  const poId = formData.get('poId');
  if (typeof poId !== 'string' || !z.string().uuid().safeParse(poId).success) {
    return { formError: 'Invalid purchase order reference.' };
  }

  const company = await getActiveCompany();
  const po = await getPurchaseOrder(company.id, poId);
  if (!po) {
    return { formError: 'Purchase order not found.' };
  }
  if (po.status === 'void') {
    return { formError: 'This purchase order is void — nothing to bill.' };
  }

  const poLines = await getPurchaseOrderLines(po.id);
  if (poLines.length === 0) {
    return { formError: 'This purchase order has no line items to bill.' };
  }

  // Pull the vendor's default expense account so each line lands on the
  // right P&L account out of the gate (operator can still re-categorize
  // before posting). Falls back to null → Uncategorized Expense on Post.
  const vendor = await getVendor(company.id, po.vendorId);
  const defaultAccountId = vendor?.defaultAccountingAccountId ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const vatRate = company.isVatActive ? Number(company.vatRatePercent) || 0 : 0;

  // PO line totals are net (qty × unit cost); add VAT on top (vatIncluded=false).
  const computedLines = poLines.map((l) => {
    const net = Number(l.lineTotal) || 0;
    const c = company.isVatActive
      ? computeVat({
          subtotal: net,
          vatRatePercent: vatRate,
          vatIncluded: false,
          driver: 'subtotal',
        })
      : { subtotal: net, vatAmount: 0, total: net, vatRatePercent: 0 };
    return { line: l, computed: c };
  });

  const receipt = await createReceipt({
    companyId: company.id,
    vendorId: po.vendorId,
    paymentSourceType: 'cash',
    receiptDate: today,
    currency: company.defaultCurrency,
    vatRatePercent: company.isVatActive ? toPercentString(vatRate) : null,
    vatIncluded: false,
    vatRecoverable: true,
    vatPeriodQuarter: company.isVatActive ? vatQuarterForDate(today) : null,
    notes: `Bill from ${po.number}`,
    subtotal: '0',
    vatAmount: '0',
    total: '0',
    uploadedByUserId: user.id,
  });

  for (const [idx, { line, computed }] of computedLines.entries()) {
    await createReceiptLine({
      companyId: company.id,
      receiptId: receipt.id,
      sortOrder: idx,
      projectId: po.projectId,
      costCodeId: line.costCodeId,
      accountingAccountId: defaultAccountId,
      description: line.description,
      subtotal: toMoneyString(computed.subtotal),
      vatAmount: toMoneyString(computed.vatAmount),
      total: toMoneyString(computed.total),
      vatRatePercent: company.isVatActive ? toPercentString(vatRate) : null,
      isBillable: false,
      isReimbursable: false,
    });
  }
  await recalcReceiptHeaderTotals(company.id, receipt.id);

  appendActivity(company.id, {
    entityType: 'purchase_order',
    entityId: po.id,
    kind: 'po_bill_created',
    summary: `Draft bill created from ${po.number} (${poLines.length} line${
      poLines.length === 1 ? '' : 's'
    }) — review and post in Banking → Receipts`,
    actorRole: ROLE_LABELS[role],
  });

  revalidatePath('/banking/receipts');
  redirect(`/banking/receipts/${receipt.id}`);
}

// ===== PDF upload + create-from-extracted (Phase 6.2) =====

export type ExtractPoPdfState = {
  formError?: string;
  extracted?: ExtractedPo;
  source?: {
    storagePath: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  };
};

export async function extractPoPdfAction(
  _prev: ExtractPoPdfState,
  formData: FormData,
): Promise<ExtractPoPdfState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { formError: 'You do not have permission to create purchase orders.' };
  }
  if (!isOcrConfigured()) {
    return {
      formError:
        'PDF extraction is not configured on this environment. Use the manual or Excel-upload flow instead.',
    };
  }

  // The source arrives either as a direct-to-storage ref (preferred — the
  // client PUT the file straight into the receipt-files bucket via a
  // signed URL, so the ~4.5MB Vercel action body cap doesn't apply) or as
  // an inline File (legacy small-file path).
  const companyIdEarly = await getActiveCompanyId();
  const refRaw = formData.get('uploads');
  let bytes: Uint8Array;
  let mime: string;
  let fileName: string;
  /** Set when the blob is already parked in receipt-files (direct path). */
  let parkedPath: string | null = null;

  if (typeof refRaw === 'string' && refRaw.trim() !== '') {
    const parsedRef = z
      .object({
        storagePath: z.string().min(1).max(500),
        fileName: z.string().min(1).max(300),
        mimeType: z.string().min(1).max(100),
      })
      .safeParse((() => {
        try {
          const arr = JSON.parse(refRaw);
          return Array.isArray(arr) ? arr[0] : arr;
        } catch {
          return null;
        }
      })());
    if (!parsedRef.success) {
      return { formError: 'Invalid upload reference — retry the upload.' };
    }
    const ref = parsedRef.data;
    if (!ref.storagePath.startsWith(`${companyIdEarly}/`)) {
      return { formError: 'Invalid upload path.' };
    }
    const stat = await statStorageObject(RECEIPT_FILES_BUCKET, ref.storagePath);
    if (!stat) {
      return { formError: 'Upload not found in storage — retry the upload.' };
    }
    if (stat.byteSize > MAX_RECEIPT_BYTES) {
      await deleteReceiptBlob(ref.storagePath).catch(() => {});
      return { formError: 'File too large (max 25 MB).' };
    }
    mime = (
      stat.mimeType && stat.mimeType !== 'application/octet-stream'
        ? stat.mimeType
        : ref.mimeType
    ).toLowerCase();
    if (!ALLOWED_RECEIPT_MIME.has(mime)) {
      await deleteReceiptBlob(ref.storagePath).catch(() => {});
      return {
        formError: `Unsupported file type ${mime}. Use PDF or a phone photo (JPG/PNG/HEIC).`,
      };
    }
    const blob = await downloadReceiptBlob(ref.storagePath);
    if (!blob) {
      return { formError: 'Could not read the uploaded file from storage — retry.' };
    }
    bytes = blob.bytes;
    fileName = ref.fileName;
    parkedPath = ref.storagePath;
  } else {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { formError: 'Choose a PDF (or image) of the estimate to upload.' };
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      return { formError: 'File too large (max 25 MB).' };
    }
    mime = (file.type || 'application/octet-stream').toLowerCase();
    if (!ALLOWED_RECEIPT_MIME.has(mime)) {
      return {
        formError: `Unsupported file type ${mime}. Use PDF or a phone photo (JPG/PNG/HEIC).`,
      };
    }
    bytes = new Uint8Array(await file.arrayBuffer());
    fileName = file.name;
  }

  // Document AI's processor backend can return a malformed gRPC status
  // when the source PDF has structural quirks (encryption-with-empty-
  // password, linearization / Fast Web View, PDF/A export, trailing
  // bytes past %%EOF, vendor "form-fillable" templates, etc.). The
  // receipts pipeline avoids this by re-creating a fresh single-page
  // PDF via pdf-lib before extraction. Do the same here for PDF
  // uploads so we get the same reliability. Images pass through
  // unchanged — Document AI handles JPG/PNG/HEIC directly.
  if (mime === 'application/pdf') {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const totalPages = source.getPageCount();
      if (totalPages === 0) {
        return { formError: 'PDF has no pages.' };
      }
      // Document AI sync processors typically cap at 10 pages. Vendor
      // estimates are almost always 1–3 pages; if the user uploads a
      // long PDF, take the first 10 pages so the extraction can still
      // run on the cover/line-item content.
      const pageCount = Math.min(totalPages, 10);
      const clean = await PDFDocument.create();
      const copied = await clean.copyPages(
        source,
        Array.from({ length: pageCount }, (_, i) => i),
      );
      for (const p of copied) clean.addPage(p);
      const cleanBytes = await clean.save();
      bytes = new Uint8Array(cleanBytes);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      return {
        formError: `Could not parse the PDF before extraction: ${detail}. Try re-exporting it from the original app, or take a phone photo of each page and upload those instead.`,
      };
    }
  }

  // Park the source in the receipt-files bucket while the user reviews the
  // extracted preview. On PO creation we re-upload to project-documents
  // (tied to the chosen project) and delete this temp copy. Direct-upload
  // refs are ALREADY parked there — reuse the blob as-is.
  let upload: { storagePath: string };
  if (parkedPath) {
    upload = { storagePath: parkedPath };
  } else {
    try {
      upload = await uploadReceiptFile({
        companyId: companyIdEarly,
        bytes,
        mimeType: mime,
        originalFileName: fileName,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { formError: `Could not stash the file for processing: ${message}` };
    }
  }

  let extracted: ExtractedPo;
  try {
    extracted = await extractPurchaseOrderFromPdf({ bytes, mimeType: mime });
  } catch (err) {
    // Best-effort cleanup so a failed extraction doesn't leave the temp
    // file behind.
    await deleteReceiptBlob(upload.storagePath).catch(() => {});
    // Surface the full error to server logs (Vercel) so we can diagnose
    // SDK / network / config issues that don't formatter-out cleanly.
    console.error('[po-upload] extractPurchaseOrderFromPdf failed', err);
    let message: string;
    if (err instanceof Error && err.message && err.message.trim() !== '') {
      message = err.message;
    } else if (err && typeof err === 'object') {
      try {
        message = JSON.stringify(err, Object.getOwnPropertyNames(err));
      } catch {
        message = 'Unknown error (non-serializable)';
      }
    } else {
      message = String(err ?? 'Unknown error');
    }
    return { formError: `Extraction failed: ${message}` };
  }

  return {
    extracted,
    source: {
      storagePath: upload.storagePath,
      fileName,
      mimeType: mime,
      byteSize: bytes.byteLength,
    },
  };
}

export type CreatePoFromExtractedState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

async function nextPoNumberForCompany(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await listPurchaseOrders(companyId);
  const matching = existing
    .map((p) => p.number)
    .filter((n) => n.startsWith(`PO-${year}-`))
    .map((n) => Number(n.slice(`PO-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `PO-${year}-${String(next).padStart(3, '0')}`;
}

export async function createPoFromExtractedAction(
  _prev: CreatePoFromExtractedState,
  formData: FormData,
): Promise<CreatePoFromExtractedState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { formError: 'You do not have permission to create purchase orders.' };
  }

  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read line items.' };
  }

  const parsed = createPoFromExtractedSchema.safeParse({
    number: formData.get('number'),
    vendorId: formData.get('vendorId'),
    projectId: formData.get('projectId'),
    issueDate: formData.get('issueDate') ?? '',
    expectedDeliveryDate: formData.get('expectedDeliveryDate') ?? '',
    taxAmount: formData.get('taxAmount') ?? '0',
    shipping: formData.get('shipping') ?? '0',
    notes: formData.get('notes') ?? '',
    lines: parsedLines,
    sourceStoragePath: formData.get('sourceStoragePath'),
    sourceFileName: formData.get('sourceFileName'),
    sourceMimeType: formData.get('sourceMimeType'),
    sourceByteSize: formData.get('sourceByteSize'),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, data.projectId);
  if (!project) {
    return { formError: 'Selected project not found in this company.' };
  }

  // Compute money totals from the parsed lines.
  const numericLines = data.lines.map((l) => ({
    quantityOrdered: Number(l.quantity),
    unitCost: Number(l.unitCost),
  }));
  const totals = calcPOTotals({
    lines: numericLines,
    taxAmount: Number(data.taxAmount),
    shipping: Number(data.shipping),
  });
  const persistLines = data.lines.map((l, i) => ({
    costCodeId: l.costCodeId,
    inventoryItemId: l.inventoryItemId && l.inventoryItemId !== '' ? l.inventoryItemId : null,
    description: l.description,
    unit: l.unit && l.unit !== '' ? l.unit : null,
    quantityOrdered: toQuantityString(numericLines[i].quantityOrdered),
    unitCost: toQuantityString(numericLines[i].unitCost),
    lineTotal: toMoneyString(multiply(numericLines[i].quantityOrdered, numericLines[i].unitCost)),
  }));

  // Resolve final PO number — caller may submit blank, fall through to the
  // server-generated next-in-sequence to avoid collisions.
  const requestedNumber = data.number.trim();
  const finalNumber =
    requestedNumber !== '' ? requestedNumber : await nextPoNumberForCompany(companyId);

  let createdId: string;
  try {
    const po = await createPurchaseOrder(companyId, {
      number: finalNumber,
      projectId: data.projectId,
      vendorId: data.vendorId,
      landedCostEntryId: null,
      status: 'draft',
      issueDate: data.issueDate?.trim() || null,
      expectedDeliveryDate: data.expectedDeliveryDate?.trim() || null,
      notes: data.notes?.trim() || null,
      subtotal: toMoneyString(totals.subtotal),
      taxAmount: toMoneyString(totals.taxAmount),
      shipping: toMoneyString(totals.shipping),
      total: toMoneyString(totals.total),
      lines: persistLines,
    });
    createdId = po.id;
  } catch (err) {
    if (err instanceof DuplicatePONumberError) {
      return { errors: { number: ['That PO number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create purchase order: ${message}` };
  }

  // Move the source PDF from the receipt-files temp bucket to the
  // project-documents bucket, then record a project_documents row so the
  // user can re-open the original estimate later. Failures here don't roll
  // back the PO — log the issue but keep the PO around.
  try {
    const blob = await downloadReceiptBlob(data.sourceStoragePath);
    if (blob) {
      const docUpload = await uploadProjectDocument({
        companyId,
        projectId: data.projectId,
        bytes: blob.bytes,
        mimeType: data.sourceMimeType,
        originalFileName: data.sourceFileName,
      });
      await createProjectDocument({
        companyId,
        projectId: data.projectId,
        uploadedBy: user.id,
        fileName: data.sourceFileName,
        originalFileName: data.sourceFileName,
        storagePath: docUpload.storagePath,
        mimeType: data.sourceMimeType,
        byteSize: data.sourceByteSize,
        changeOrderId: null,
        category: 'estimate',
        description: `Source PDF for PO ${finalNumber}`,
        visibleToClient: false,
        parentDocumentId: null,
        versionNumber: 1,
        isCurrentVersion: true,
        sortOrder: 0,
      });
      await deleteReceiptBlob(data.sourceStoragePath).catch(() => {});
    }
  } catch (err) {
    // Storage hiccup shouldn't take the PO down with it — the user can
    // re-upload the source manually in the project documents view. Log it
    // (was silently swallowed) so a persistent attach failure is visible,
    // and leave a breadcrumb on the PO.
    console.error(
      `[po-from-pdf] failed to attach source PDF for PO ${finalNumber}:`,
      err,
    );
    appendActivity(companyId, {
      entityType: 'purchase_order',
      entityId: createdId,
      kind: 'po_created_from_pdf',
      summary: `Source PDF for PO ${finalNumber} could not be attached — re-upload it in project documents.`,
      actorRole: ROLE_LABELS[role],
    });
  }

  appendActivity(companyId, {
    entityType: 'purchase_order',
    entityId: createdId,
    kind: 'po_created_from_pdf',
    summary: `Draft PO ${finalNumber} created from uploaded estimate (${data.sourceFileName})`,
    actorRole: ROLE_LABELS[role],
  });

  revalidatePath('/purchase-orders');
  revalidatePath('/dashboard');
  revalidatePath(`/projects/${data.projectId}`);
  redirect(`/purchase-orders/${createdId}`);
}

// ===== Diagnostic: connectivity test for Document AI =====
// Bypasses processDocument and calls listProcessors instead — isolates auth
// / transport / API-enabled issues from the document-processing path so we
// can tell whether an extraction failure is a credentials problem or a
// processor-specific one.

export type DocumentAiDiagnosisState = DocumentAiDiagnosis | { ok: false; formError: string };

export async function runDocumentAiDiagnosisAction(
  _prev: DocumentAiDiagnosisState | null,
): Promise<DocumentAiDiagnosisState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) {
    return { ok: false, formError: 'No permission.' };
  }
  return await diagnoseDocumentAi();
}
