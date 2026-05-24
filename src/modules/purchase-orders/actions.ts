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
import { poReceiptFormSchema, purchaseOrderFormSchema } from './schema';

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
