'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import {
  calcPOTotals,
  multiply,
  toMoneyString,
  toQuantityString,
} from '@/lib/money';
import {
  createMockPurchaseOrder,
  DuplicatePONumberError,
} from '@/lib/mock-store';
import { purchaseOrderFormSchema } from './schema';

export type CreatePurchaseOrderState = {
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
    description: l.description,
    unit: emptyToNull(l.unit ?? null),
    quantityOrdered: toQuantityString(numericLines[i].quantityOrdered),
    unitCost: toQuantityString(numericLines[i].unitCost),
    lineTotal: toMoneyString(multiply(numericLines[i].quantityOrdered, numericLines[i].unitCost)),
  }));

  const companyId = await getActiveCompanyId();
  let createdId: string;
  try {
    const po = createMockPurchaseOrder(companyId, {
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
