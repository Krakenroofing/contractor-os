// Async data accessor for inventory_items — the product/material master
// catalog that feeds searchable dropdowns on POs, Invoices, and Estimates.
//
// Phase 6.0 only does catalog CRUD + a bulk-insert path for the QuickBooks
// Product List importer. On-hand quantity, locations, receiving, and
// issuance to jobs are not part of this table.

import 'server-only';
import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm';
import { inventoryItems, type InventoryItem, type NewInventoryItem } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type CreateInventoryItemInput = {
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  defaultCost: string;
  defaultCostCodeId: string | null;
  isTaxable: boolean;
  qbGlAccountText: string | null;
  notes: string | null;
};

export type UpdateInventoryItemInput = Partial<CreateInventoryItemInput>;

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new Error('inventory_items requires a configured database — demo mode is not supported yet.');
  }
  return getDb()!;
}

export async function listInventoryItems(
  companyId: string,
  opts: { includeArchived?: boolean; search?: string; limit?: number } = {},
): Promise<InventoryItem[]> {
  const db = requireDb();
  const filters = [eq(inventoryItems.companyId, companyId)];
  if (!opts.includeArchived) filters.push(isNull(inventoryItems.archivedAt));
  const search = opts.search?.trim();
  if (search && search.length > 0) {
    const like = `%${search}%`;
    const orFilter = or(
      ilike(inventoryItems.name, like),
      ilike(inventoryItems.sku, like),
      ilike(inventoryItems.category, like),
    );
    if (orFilter) filters.push(orFilter);
  }
  const q = db
    .select()
    .from(inventoryItems)
    .where(and(...filters))
    .orderBy(asc(inventoryItems.name));
  if (opts.limit && opts.limit > 0) {
    return await q.limit(opts.limit);
  }
  return await q;
}

export async function getInventoryItem(
  companyId: string,
  id: string,
): Promise<InventoryItem | undefined> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.companyId, companyId)))
    .limit(1);
  return rows[0];
}

export async function createInventoryItem(
  companyId: string,
  input: CreateInventoryItemInput,
): Promise<InventoryItem> {
  const db = requireDb();
  const rows = await db
    .insert(inventoryItems)
    .values({ ...input, companyId })
    .returning();
  return rows[0];
}

export async function updateInventoryItem(
  companyId: string,
  id: string,
  patch: UpdateInventoryItemInput,
): Promise<InventoryItem | undefined> {
  const db = requireDb();
  const rows = await db
    .update(inventoryItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.companyId, companyId)))
    .returning();
  return rows[0];
}

export async function archiveInventoryItem(
  companyId: string,
  id: string,
): Promise<void> {
  const db = requireDb();
  await db
    .update(inventoryItems)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.companyId, companyId)));
}

export async function unarchiveInventoryItem(
  companyId: string,
  id: string,
): Promise<void> {
  const db = requireDb();
  await db
    .update(inventoryItems)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.companyId, companyId)));
}

// Used by the QB Product List importer. Skips rows whose SKU already
// exists in the catalog (returning a count for the operator).
export async function bulkInsertInventoryItems(
  companyId: string,
  rows: CreateInventoryItemInput[],
): Promise<{ inserted: number; skipped: number; skippedSkus: string[] }> {
  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, skippedSkus: [] };
  }
  const db = requireDb();

  // Pre-fetch existing SKUs to skip duplicates. Empty-SKU rows always insert.
  const existingRows = await db
    .select({ sku: inventoryItems.sku })
    .from(inventoryItems)
    .where(eq(inventoryItems.companyId, companyId));
  const existingSkus = new Set(
    existingRows.map((r) => r.sku).filter((s): s is string => s !== null),
  );

  const toInsert: NewInventoryItem[] = [];
  const skippedSkus: string[] = [];
  for (const row of rows) {
    if (row.sku && existingSkus.has(row.sku)) {
      skippedSkus.push(row.sku);
      continue;
    }
    toInsert.push({ ...row, companyId });
    if (row.sku) existingSkus.add(row.sku);
  }

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: skippedSkus.length, skippedSkus };
  }

  await db.insert(inventoryItems).values(toInsert);
  return {
    inserted: toInsert.length,
    skipped: skippedSkus.length,
    skippedSkus,
  };
}
