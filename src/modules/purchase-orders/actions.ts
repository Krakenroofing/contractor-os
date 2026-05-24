'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate, ROLE_LABELS } from '@/lib/permissions';
import { appendActivity } from '@/lib/mock-store';
import {
  calcPOTotals,
  multiply,
  toMoneyString,
  toQuantityString,
} from '@/lib/money';
import {
  createPurchaseOrder,
  DuplicatePONumberError,
  getPurchaseOrder,
  updatePurchaseOrderHeader,
} from '@/lib/data/purchase-orders';
import {
  createPoReceipt,
  deletePoReceipt,
} from '@/lib/data/po-receipts';
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
  deleteReceiptBlob,
  downloadReceiptBlob,
  uploadReceiptFile,
} from '@/lib/storage/receipt-files';
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

  let resultingStatus: string;
  try {
    const result = await createPoReceipt(companyId, po.id, {
      receivedAt,
      receivedByUserId: user.id,
      notes: parsed.data.notes?.trim() || null,
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

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { formError: 'Choose a PDF (or image) of the estimate to upload.' };
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return { formError: 'File too large (max 25 MB).' };
  }
  const mime = (file.type || 'application/octet-stream').toLowerCase();
  if (!ALLOWED_RECEIPT_MIME.has(mime)) {
    return {
      formError: `Unsupported file type ${mime}. Use PDF or a phone photo (JPG/PNG/HEIC).`,
    };
  }

  let bytes = new Uint8Array(await file.arrayBuffer());

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

  const companyId = await getActiveCompanyId();
  // Park the source in the receipt-files bucket while the user reviews the
  // extracted preview. On PO creation we re-upload to project-documents
  // (tied to the chosen project) and delete this temp copy.
  let upload: { storagePath: string };
  try {
    upload = await uploadReceiptFile({
      companyId,
      bytes,
      mimeType: mime,
      originalFileName: file.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Could not stash the file for processing: ${message}` };
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
      fileName: file.name,
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
  } catch {
    // Storage hiccup shouldn't take the PO down with it — the user can
    // re-upload the source manually in the project documents view.
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
