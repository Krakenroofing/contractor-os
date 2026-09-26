import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  inventoryCategoryCostCodes,
  vendorItemNumbers,
  vendors,
  type VendorItemNumber,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type VendorNumberRef = { vendorId: string; number: string };

export async function listVendorItemNumbers(
  companyId: string,
): Promise<VendorItemNumber[]> {
  if (!isDatabaseConfigured()) return [];
  return getDb()!
    .select()
    .from(vendorItemNumbers)
    .where(eq(vendorItemNumbers.companyId, companyId))
    .orderBy(asc(vendorItemNumbers.vendorItemNumber));
}

/** item id → the vendor numbers on it (for pickers + the PDF matcher). */
export async function vendorNumbersByItem(
  companyId: string,
): Promise<Map<string, VendorNumberRef[]>> {
  const out = new Map<string, VendorNumberRef[]>();
  for (const r of await listVendorItemNumbers(companyId)) {
    const arr = out.get(r.inventoryItemId) ?? [];
    arr.push({ vendorId: r.vendorId, number: r.vendorItemNumber });
    out.set(r.inventoryItemId, arr);
  }
  return out;
}

export async function listVendorNumbersForItem(
  companyId: string,
  inventoryItemId: string,
): Promise<Array<VendorItemNumber & { vendorName: string }>> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getDb()!
    .select({ v: vendorItemNumbers, vendorName: vendors.name })
    .from(vendorItemNumbers)
    .innerJoin(vendors, eq(vendors.id, vendorItemNumbers.vendorId))
    .where(
      and(
        eq(vendorItemNumbers.companyId, companyId),
        eq(vendorItemNumbers.inventoryItemId, inventoryItemId),
      ),
    )
    .orderBy(asc(vendors.name));
  return rows.map((r) => ({ ...r.v, vendorName: r.vendorName }));
}

export class VendorNumberTakenError extends Error {
  constructor(public readonly itemId: string) {
    super('That vendor item number already points at another product.');
  }
}

/** Link a vendor's item number to a product. Re-linking the same number to
 *  the same product is a no-op; pointing it at a different product is
 *  refused (one vendor number = one product) unless `move` is set. */
export async function upsertVendorItemNumber(input: {
  companyId: string;
  vendorId: string;
  inventoryItemId: string;
  vendorItemNumber: string;
  vendorDescription?: string | null;
  move?: boolean;
}): Promise<void> {
  const db = getDb()!;
  const number = input.vendorItemNumber.trim();
  if (!number) throw new Error('Enter the vendor’s item number.');
  const [existing] = await db
    .select()
    .from(vendorItemNumbers)
    .where(
      and(
        eq(vendorItemNumbers.companyId, input.companyId),
        eq(vendorItemNumbers.vendorId, input.vendorId),
        sql`lower(btrim(${vendorItemNumbers.vendorItemNumber})) = lower(${number})`,
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.inventoryItemId === input.inventoryItemId) return;
    if (!input.move) throw new VendorNumberTakenError(existing.inventoryItemId);
    await db
      .update(vendorItemNumbers)
      .set({
        inventoryItemId: input.inventoryItemId,
        vendorDescription: input.vendorDescription ?? existing.vendorDescription,
        updatedAt: new Date(),
      })
      .where(eq(vendorItemNumbers.id, existing.id));
    return;
  }
  await db.insert(vendorItemNumbers).values({
    companyId: input.companyId,
    vendorId: input.vendorId,
    inventoryItemId: input.inventoryItemId,
    vendorItemNumber: number,
    vendorDescription: input.vendorDescription ?? null,
  });
}

export async function deleteVendorItemNumber(
  companyId: string,
  id: string,
): Promise<void> {
  await getDb()!
    .delete(vendorItemNumbers)
    .where(
      and(eq(vendorItemNumbers.id, id), eq(vendorItemNumbers.companyId, companyId)),
    );
}

// ----- Category default cost codes -----

export async function listCategoryCostCodes(
  companyId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isDatabaseConfigured()) return out;
  const rows = await getDb()!
    .select()
    .from(inventoryCategoryCostCodes)
    .where(eq(inventoryCategoryCostCodes.companyId, companyId));
  for (const r of rows) out.set(r.category.trim().toLowerCase(), r.costCodeId);
  return out;
}

export async function setCategoryCostCode(
  companyId: string,
  category: string,
  costCodeId: string | null,
): Promise<void> {
  const db = getDb()!;
  const cat = category.trim();
  if (!cat) return;
  if (!costCodeId) {
    await db
      .delete(inventoryCategoryCostCodes)
      .where(
        and(
          eq(inventoryCategoryCostCodes.companyId, companyId),
          eq(inventoryCategoryCostCodes.category, cat),
        ),
      );
    return;
  }
  await db
    .insert(inventoryCategoryCostCodes)
    .values({ companyId, category: cat, costCodeId })
    .onConflictDoUpdate({
      target: [inventoryCategoryCostCodes.companyId, inventoryCategoryCostCodes.category],
      set: { costCodeId, updatedAt: new Date() },
    });
}

/** The cost code a product should normally post to: its own default, else
 *  its category's default. Null = no expectation (no warning). */
export function expectedCostCodeFor(
  item: { defaultCostCodeId: string | null; category: string | null } | undefined,
  categoryDefaults: Map<string, string>,
): string | null {
  if (!item) return null;
  if (item.defaultCostCodeId) return item.defaultCostCodeId;
  const cat = item.category?.trim().toLowerCase();
  return cat ? (categoryDefaults.get(cat) ?? null) : null;
}
