import 'server-only';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  inventoryCategories,
  inventoryCategoryCostCodes,
  inventoryItems,
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

// ----- Managed category list (Group > Category) -----

export type InventoryCategoryOption = { id: string; group: string; name: string };

export async function listInventoryCategories(
  companyId: string,
): Promise<InventoryCategoryOption[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getDb()!
    .select()
    .from(inventoryCategories)
    .where(
      and(
        eq(inventoryCategories.companyId, companyId),
        isNull(inventoryCategories.archivedAt),
      ),
    )
    .orderBy(asc(inventoryCategories.sortOrder), asc(inventoryCategories.name));
  return rows.map((r) => ({ id: r.id, group: r.groupName, name: r.name }));
}

/** The canonical category name for free text, or undefined when the
 *  company manages its list and the text isn't on it. Null = blank. */
export async function canonicalCategory(
  companyId: string,
  text: string | null,
): Promise<string | null | undefined> {
  const t = (text ?? '').trim();
  if (!t) return null;
  const list = await listInventoryCategories(companyId);
  if (list.length === 0) return t; // no managed list — free text allowed
  return list.find((c) => c.name.toLowerCase() === t.toLowerCase())?.name;
}

export async function addInventoryCategory(
  companyId: string,
  group: string,
  name: string,
): Promise<void> {
  const db = getDb()!;
  const [last] = await db
    .select({ max: sql<number>`COALESCE(MAX(${inventoryCategories.sortOrder}), 0)` })
    .from(inventoryCategories)
    .where(eq(inventoryCategories.companyId, companyId));
  await db
    .insert(inventoryCategories)
    .values({
      companyId,
      groupName: group.trim(),
      name: name.trim(),
      source: 'Added',
      sortOrder: Number(last?.max ?? 0) + 10,
    })
    .onConflictDoNothing();
}

// ----- Category defaults (cost code + accounting category) -----

export type CategoryDefaults = { costCodeId: string | null; accountId: string | null };

/** lower(category) → its default cost code and accounting category. */
export async function listCategoryDefaults(
  companyId: string,
): Promise<Map<string, CategoryDefaults>> {
  const out = new Map<string, CategoryDefaults>();
  if (!isDatabaseConfigured()) return out;
  const rows = await getDb()!
    .select()
    .from(inventoryCategoryCostCodes)
    .where(eq(inventoryCategoryCostCodes.companyId, companyId));
  for (const r of rows) {
    out.set(r.category.trim().toLowerCase(), {
      costCodeId: r.costCodeId,
      accountId: r.accountingAccountId,
    });
  }
  return out;
}

/** lower(category) → default cost code (the P4 shape). */
export async function listCategoryCostCodes(
  companyId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [k, v] of await listCategoryDefaults(companyId)) {
    if (v.costCodeId) out.set(k, v.costCodeId);
  }
  return out;
}

/** Set one or both of a category's defaults; a row with neither is removed. */
export async function setCategoryDefaults(
  companyId: string,
  category: string,
  patch: { costCodeId?: string | null; accountId?: string | null },
): Promise<void> {
  const db = getDb()!;
  const cat = category.trim();
  if (!cat) return;
  const where = and(
    eq(inventoryCategoryCostCodes.companyId, companyId),
    eq(inventoryCategoryCostCodes.category, cat),
  );
  const [existing] = await db.select().from(inventoryCategoryCostCodes).where(where);
  const next = {
    costCodeId:
      patch.costCodeId !== undefined ? patch.costCodeId : (existing?.costCodeId ?? null),
    accountingAccountId:
      patch.accountId !== undefined
        ? patch.accountId
        : (existing?.accountingAccountId ?? null),
  };
  if (!next.costCodeId && !next.accountingAccountId) {
    await db.delete(inventoryCategoryCostCodes).where(where);
    return;
  }
  await db
    .insert(inventoryCategoryCostCodes)
    .values({ companyId, category: cat, ...next })
    .onConflictDoUpdate({
      target: [inventoryCategoryCostCodes.companyId, inventoryCategoryCostCodes.category],
      set: { ...next, updatedAt: new Date() },
    });
}

export async function setCategoryCostCode(
  companyId: string,
  category: string,
  costCodeId: string | null,
): Promise<void> {
  await setCategoryDefaults(companyId, category, { costCodeId });
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

/** A product's effective defaults: its own, else its category's. */
export function effectiveItemDefaults(
  item: {
    defaultCostCodeId: string | null;
    defaultAccountingAccountId: string | null;
    category: string | null;
  },
  categoryDefaults: Map<string, CategoryDefaults>,
): CategoryDefaults {
  const cat = categoryDefaults.get(item.category?.trim().toLowerCase() ?? '');
  return {
    costCodeId: item.defaultCostCodeId ?? cat?.costCodeId ?? null,
    accountId: item.defaultAccountingAccountId ?? cat?.accountId ?? null,
  };
}

/** Last unit price paid per product per vendor (latest PO line, by PO
 *  date) — the default unit cost when that vendor's product is picked. */
export async function lastPricesByItem(
  companyId: string,
): Promise<Map<string, Array<{ vendorId: string; unitCost: number }>>> {
  const out = new Map<string, Array<{ vendorId: string; unitCost: number }>>();
  if (!isDatabaseConfigured()) return out;
  const rows = await getDb()!.execute(sql`
    SELECT DISTINCT ON (pl.inventory_item_id, po.vendor_id)
           pl.inventory_item_id, po.vendor_id, pl.unit_cost
      FROM purchase_order_lines pl
      JOIN purchase_orders po ON po.id = pl.purchase_order_id
     WHERE po.company_id = ${companyId} AND po.status <> 'void'
       AND pl.inventory_item_id IS NOT NULL AND pl.unit_cost > 0
     ORDER BY pl.inventory_item_id, po.vendor_id,
              COALESCE(po.issue_date, po.created_at::date) DESC, po.created_at DESC`);
  for (const r of rows as unknown as Array<Record<string, string>>) {
    const arr = out.get(r.inventory_item_id) ?? [];
    arr.push({ vendorId: r.vendor_id, unitCost: Number(r.unit_cost) });
    out.set(r.inventory_item_id, arr);
  }
  return out;
}

/**
 * Accounting category for PO lines, by the standing chain: the line's own
 * → its product's default → the product category's default → the vendor's
 * default. Null only when none of them is set.
 */
export async function resolvePoLineAccounts(
  companyId: string,
  vendorId: string,
  lines: Array<{ accountingAccountId: string | null; inventoryItemId: string | null }>,
): Promise<Array<string | null>> {
  if (!isDatabaseConfigured()) return lines.map((l) => l.accountingAccountId);
  const db = getDb()!;
  const itemIds = [
    ...new Set(lines.map((l) => l.inventoryItemId).filter((x): x is string => !!x)),
  ];
  const items = itemIds.length
    ? await db
        .select({
          id: inventoryItems.id,
          category: inventoryItems.category,
          defaultCostCodeId: inventoryItems.defaultCostCodeId,
          defaultAccountingAccountId: inventoryItems.defaultAccountingAccountId,
        })
        .from(inventoryItems)
        .where(
          and(eq(inventoryItems.companyId, companyId), inArray(inventoryItems.id, itemIds)),
        )
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const catDefaults = await listCategoryDefaults(companyId);
  const [vendor] = await db
    .select({ accountId: vendors.defaultAccountingAccountId })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId)))
    .limit(1);
  return lines.map((l) => {
    if (l.accountingAccountId) return l.accountingAccountId;
    const item = l.inventoryItemId ? itemById.get(l.inventoryItemId) : undefined;
    const fromItem = item ? effectiveItemDefaults(item, catDefaults).accountId : null;
    return fromItem ?? vendor?.accountId ?? null;
  });
}
