'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  archiveInventoryItem,
  bulkInsertInventoryItems,
  createInventoryItem,
  unarchiveInventoryItem,
  updateInventoryItem,
  type CreateInventoryItemInput,
} from '@/lib/data/inventory-items';
import { inventoryItemFormSchema } from './schema';

export type InventoryItemState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function readForm(formData: FormData) {
  return {
    name: formData.get('name') ?? '',
    category: formData.get('category') ?? '',
    sku: formData.get('sku') ?? '',
    unit: formData.get('unit') ?? '',
    defaultCost: (formData.get('defaultCost') as string | null) ?? '0',
    defaultCostCodeId: formData.get('defaultCostCodeId') ?? '',
    isTaxable: (formData.get('isTaxable') as string | null) ?? 'yes',
    qbGlAccountText: formData.get('qbGlAccountText') ?? '',
    notes: formData.get('notes') ?? '',
  };
}

function toCreateInput(
  data: z.output<typeof inventoryItemFormSchema>,
): CreateInventoryItemInput {
  return {
    name: data.name.trim(),
    category: emptyToNull(data.category ?? null),
    sku: emptyToNull(data.sku ?? null),
    unit: emptyToNull(data.unit ?? null),
    defaultCost:
      data.defaultCost.trim() === '' ? '0' : Number(data.defaultCost).toFixed(4),
    defaultCostCodeId: emptyToNull(data.defaultCostCodeId ?? null),
    isTaxable: data.isTaxable === 'yes',
    qbGlAccountText: emptyToNull(data.qbGlAccountText ?? null),
    notes: emptyToNull(data.notes ?? null),
  };
}

export async function createInventoryItemAction(
  _prev: InventoryItemState,
  formData: FormData,
): Promise<InventoryItemState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'You do not have permission to manage products.' };
  }
  const parsed = inventoryItemFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const companyId = await getActiveCompanyId();
  let createdId: string;
  try {
    const item = await createInventoryItem(companyId, toCreateInput(parsed.data));
    createdId = item.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create product: ${message}` };
  }
  revalidatePath('/inventory');
  redirect(`/inventory/${createdId}`);
}

const idSchema = z.string().uuid('Missing or invalid id');

export async function updateInventoryItemAction(
  _prev: InventoryItemState,
  formData: FormData,
): Promise<InventoryItemState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'You do not have permission to edit products.' };
  }
  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing product id on the form.' };
  }
  const parsed = inventoryItemFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const companyId = await getActiveCompanyId();
  try {
    const updated = await updateInventoryItem(
      companyId,
      idResult.data,
      toCreateInput(parsed.data),
    );
    if (!updated) {
      return { formError: 'Product not found in the active company.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save product: ${message}` };
  }
  revalidatePath('/inventory');
  revalidatePath(`/inventory/${idResult.data}`);
  redirect(`/inventory/${idResult.data}`);
}

export async function archiveInventoryItemAction(
  _prev: { formError?: string },
  formData: FormData,
): Promise<{ formError?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'You do not have permission to archive products.' };
  }
  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) return { formError: 'Missing product id.' };
  const companyId = await getActiveCompanyId();
  try {
    await archiveInventoryItem(companyId, idResult.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to archive: ${message}` };
  }
  revalidatePath('/inventory');
  redirect('/inventory');
}

export async function unarchiveInventoryItemAction(
  _prev: { formError?: string },
  formData: FormData,
): Promise<{ formError?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'You do not have permission to restore products.' };
  }
  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) return { formError: 'Missing product id.' };
  const companyId = await getActiveCompanyId();
  await unarchiveInventoryItem(companyId, idResult.data);
  revalidatePath('/inventory');
  redirect(`/inventory/${idResult.data}`);
}

// QuickBooks Product List importer. The browser uploads the .xls,
// the server-side parser produces a row[]; this action persists.
const importRowSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(120).nullable(),
  sku: z.string().max(60).nullable(),
  unit: z.string().max(20).nullable(),
  defaultCost: z.string(),
  isTaxable: z.boolean(),
  qbGlAccountText: z.string().nullable(),
});

const importPayloadSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(5000),
});

export type ImportInventoryItemsState = {
  formError?: string;
  result?: { inserted: number; skipped: number; skippedSkus: string[] };
};

export async function importInventoryItemsAction(
  _prev: ImportInventoryItemsState,
  formData: FormData,
): Promise<ImportInventoryItemsState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'You do not have permission to import products.' };
  }
  const payloadStr = formData.get('payload');
  if (typeof payloadStr !== 'string') {
    return { formError: 'Missing import payload.' };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payloadStr);
  } catch {
    return { formError: 'Could not read the import payload.' };
  }
  const parsed = importPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { formError: 'Some rows in the file are invalid.' };
  }
  const companyId = await getActiveCompanyId();
  const inputs: CreateInventoryItemInput[] = parsed.data.rows.map((r) => ({
    name: r.name.trim(),
    category: r.category && r.category.trim() !== '' ? r.category.trim() : null,
    sku: r.sku && r.sku.trim() !== '' ? r.sku.trim() : null,
    unit: r.unit && r.unit.trim() !== '' ? r.unit.trim() : null,
    defaultCost: r.defaultCost.trim() === '' ? '0' : Number(r.defaultCost).toFixed(4),
    defaultCostCodeId: null,
    isTaxable: r.isTaxable,
    qbGlAccountText:
      r.qbGlAccountText && r.qbGlAccountText.trim() !== ''
        ? r.qbGlAccountText.trim()
        : null,
    notes: null,
  }));
  try {
    const result = await bulkInsertInventoryItems(companyId, inputs);
    revalidatePath('/inventory');
    return { result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to import: ${message}` };
  }
}
