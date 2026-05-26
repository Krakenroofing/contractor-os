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
  getInventoryItem,
  unarchiveInventoryItem,
  updateInventoryItem,
  type CreateInventoryItemInput,
} from '@/lib/data/inventory-items';
import { recordInventoryMovement } from '@/lib/data/inventory-movements';
import {
  archiveInventoryLocation,
  createInventoryLocation,
  getDefaultLocation,
  setDefaultLocation,
  unarchiveInventoryLocation,
} from '@/lib/data/inventory-locations';
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

// ===== Phase 6.3: manual inventory adjustments =====

const adjustmentSchema = z.object({
  inventoryItemId: z.string().uuid('Invalid product id'),
  // Optional — when empty, the action resolves to the company default
  // location. Required at the UI level via the picker; this leniency is
  // only for legacy callers and migration tooling.
  locationId: z.string().uuid('Invalid location id').optional().or(z.literal('')),
  delta: z
    .string()
    .refine(
      (v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) !== 0,
      { message: 'Enter a non-zero number (use a leading minus for write-offs)' },
    ),
  reason: z.string().min(1, 'Add a short reason').max(500),
});

export type RecordAdjustmentState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export async function recordInventoryAdjustmentAction(
  _prev: RecordAdjustmentState,
  formData: FormData,
): Promise<RecordAdjustmentState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'You do not have permission to adjust inventory.' };
  }

  const parsed = adjustmentSchema.safeParse({
    inventoryItemId: formData.get('inventoryItemId'),
    locationId: formData.get('locationId') ?? '',
    delta: formData.get('delta'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const item = await getInventoryItem(companyId, parsed.data.inventoryItemId);
  if (!item) {
    return { formError: 'Product not found in the active company.' };
  }

  // Resolve location: prefer the explicit pick, fall back to the company
  // default. If the company has no default (operator archived all
  // locations and didn't pick one), surface a clear error instead of
  // writing a NULL-located movement that won't appear in per-location
  // on-hand queries.
  let locationId: string | null = parsed.data.locationId && parsed.data.locationId !== ''
    ? parsed.data.locationId
    : null;
  if (!locationId) {
    const def = await getDefaultLocation(companyId);
    if (!def) {
      return {
        formError:
          'No default stock location is configured. Visit /inventory/locations to create one before recording adjustments.',
      };
    }
    locationId = def.id;
  }

  const delta = Number(parsed.data.delta);

  try {
    await recordInventoryMovement({
      companyId,
      inventoryItemId: item.id,
      quantity: delta.toFixed(4),
      movementType: 'adjustment',
      occurredAt: new Date(),
      createdByUserId: user.id,
      notes: parsed.data.reason.trim(),
      poReceiptLineId: null,
      projectId: null,
      reversalOfId: null,
      locationId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to record adjustment: ${message}` };
  }

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${item.id}`);
  return {};
}

// ===== Phase 6.4: stock locations management =====

const locationCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  notes: z.string().max(500).optional().or(z.literal('')),
  isDefault: z.coerce.boolean().optional(),
});

export type LocationActionState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export async function createInventoryLocationAction(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'You do not have permission to manage stock locations.' };
  }
  const parsed = locationCreateSchema.safeParse({
    name: formData.get('name'),
    notes: formData.get('notes') ?? '',
    isDefault: formData.get('isDefault') === 'on',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const companyId = await getActiveCompanyId();
  try {
    await createInventoryLocation(companyId, {
      name: parsed.data.name.trim(),
      notes:
        parsed.data.notes && parsed.data.notes.trim() !== ''
          ? parsed.data.notes.trim()
          : null,
      isDefault: parsed.data.isDefault,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Could not create location: ${message}` };
  }
  revalidatePath('/inventory/locations');
  return {};
}

const locationIdSchema = z.object({ id: z.string().uuid('Invalid location id') });

export async function setDefaultLocationAction(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'No permission.' };
  }
  const parsed = locationIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { formError: 'Missing or invalid id.' };
  const companyId = await getActiveCompanyId();
  await setDefaultLocation(companyId, parsed.data.id);
  revalidatePath('/inventory/locations');
  return {};
}

export async function archiveInventoryLocationAction(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'No permission.' };
  }
  const parsed = locationIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { formError: 'Missing or invalid id.' };
  const companyId = await getActiveCompanyId();
  try {
    await archiveInventoryLocation(companyId, parsed.data.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: message };
  }
  revalidatePath('/inventory/locations');
  return {};
}

export async function unarchiveInventoryLocationAction(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) {
    return { formError: 'No permission.' };
  }
  const parsed = locationIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { formError: 'Missing or invalid id.' };
  const companyId = await getActiveCompanyId();
  await unarchiveInventoryLocation(companyId, parsed.data.id);
  revalidatePath('/inventory/locations');
  return {};
}
