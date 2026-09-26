'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getInventoryItem, updateInventoryItem } from '@/lib/data/inventory-items';
import { getVendor } from '@/lib/data/vendors';
import {
  deleteVendorItemNumber,
  setCategoryCostCode,
  setCategoryDefaults,
  upsertVendorItemNumber,
  VendorNumberTakenError,
} from '@/lib/data/vendor-item-numbers';

type Result = { ok: boolean; error?: string; takenByItemId?: string };

export async function addVendorItemNumberAction(input: {
  itemId: string;
  vendorId: string;
  number: string;
  description?: string;
  /** Re-point a number that currently belongs to another product. */
  move?: boolean;
}): Promise<Result> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) return { ok: false, error: 'No permission.' };
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      vendorId: z.string().uuid('Pick a vendor'),
      number: z.string().trim().min(1, 'Enter the vendor’s item number').max(80),
      description: z.string().trim().max(300).optional(),
      move: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const companyId = await getActiveCompanyId();
  const [item, vendor] = await Promise.all([
    getInventoryItem(companyId, parsed.data.itemId),
    getVendor(companyId, parsed.data.vendorId),
  ]);
  if (!item || !vendor) return { ok: false, error: 'Product or vendor not found.' };
  try {
    await upsertVendorItemNumber({
      companyId,
      vendorId: vendor.id,
      inventoryItemId: item.id,
      vendorItemNumber: parsed.data.number,
      vendorDescription: parsed.data.description || null,
      move: parsed.data.move,
    });
  } catch (err) {
    if (err instanceof VendorNumberTakenError) {
      return {
        ok: false,
        error: `${vendor.name} #${parsed.data.number} is already linked to another product.`,
        takenByItemId: err.itemId,
      };
    }
    return { ok: false, error: 'Could not save the vendor item number.' };
  }
  revalidatePath(`/inventory/${item.id}`);
  return { ok: true };
}

export async function deleteVendorItemNumberAction(input: {
  id: string;
  itemId: string;
}): Promise<Result> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) return { ok: false, error: 'No permission.' };
  if (!z.string().uuid().safeParse(input.id).success) {
    return { ok: false, error: 'Invalid id.' };
  }
  const companyId = await getActiveCompanyId();
  await deleteVendorItemNumber(companyId, input.id);
  revalidatePath(`/inventory/${input.itemId}`);
  return { ok: true };
}

/** Save a product's default cost code and/or accounting category — the
 *  PO form's "make this the default for the item" prompt. */
export async function setInventoryItemDefaultsAction(input: {
  itemId: string;
  costCodeId?: string | null;
  accountId?: string | null;
}): Promise<Result> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) return { ok: false, error: 'No permission.' };
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      costCodeId: z.string().uuid().nullable().optional(),
      accountId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const companyId = await getActiveCompanyId();
  const item = await getInventoryItem(companyId, parsed.data.itemId);
  if (!item) return { ok: false, error: 'Product not found.' };
  await updateInventoryItem(companyId, item.id, {
    ...(parsed.data.costCodeId !== undefined
      ? { defaultCostCodeId: parsed.data.costCodeId }
      : {}),
    ...(parsed.data.accountId !== undefined
      ? { defaultAccountingAccountId: parsed.data.accountId }
      : {}),
  });
  revalidatePath(`/inventory/${item.id}`);
  return { ok: true };
}

export async function setCategoryDefaultsAction(input: {
  category: string;
  costCodeId?: string | null;
  accountId?: string | null;
}): Promise<Result> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) return { ok: false, error: 'No permission.' };
  const parsed = z
    .object({
      category: z.string().trim().min(1).max(200),
      costCodeId: z.string().uuid().nullable().optional(),
      accountId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const companyId = await getActiveCompanyId();
  await setCategoryDefaults(companyId, parsed.data.category, {
    costCodeId: parsed.data.costCodeId,
    accountId: parsed.data.accountId,
  });
  revalidatePath('/inventory');
  revalidatePath('/purchase-orders');
  return { ok: true };
}

export async function setCategoryCostCodeAction(input: {
  category: string;
  costCodeId: string | null;
}): Promise<Result> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) return { ok: false, error: 'No permission.' };
  const parsed = z
    .object({
      category: z.string().trim().min(1).max(200),
      costCodeId: z.string().uuid().nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const companyId = await getActiveCompanyId();
  await setCategoryCostCode(companyId, parsed.data.category, parsed.data.costCodeId);
  revalidatePath('/inventory');
  revalidatePath('/purchase-orders');
  return { ok: true };
}
