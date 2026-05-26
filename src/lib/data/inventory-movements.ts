// Data layer for the Phase 6.3 inventory ledger.
//
// Read shape: on-hand is a SUM(quantity) over inventory_movements,
// computed on demand. No materialized snapshot — the volume is small
// enough that the aggregate-on-read is plenty fast and avoids the
// consistency drift of a denormalized counter.
//
// Write shape: every change to on-hand is a single INSERT. The hot path
// (PO receipt creation) batches the inserts inside the same transaction
// that bumps purchase_order_lines.quantity_received, so the ledger and
// the rollup can never disagree.

import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  inventoryMovements,
  type InventoryMovement,
  type NewInventoryMovement,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'inventory_movements requires a configured database — demo mode is not supported.',
    );
  }
  return getDb()!;
}

/**
 * Insert a single ledger row. Most receipt-driven writes go through the
 * batched helper inside the PO receipt transaction; this is the entry
 * point for manual adjustments and (later) issue-to-job.
 */
export async function recordInventoryMovement(
  input: NewInventoryMovement,
): Promise<InventoryMovement> {
  const db = requireDb();
  const [row] = await db.insert(inventoryMovements).values(input).returning();
  return row;
}

/**
 * Sum on-hand for one item. Returns 0 if no movements exist.
 * When locationId is provided, sums only movements at that location.
 * Otherwise aggregates across every location.
 */
export async function getOnHandForItem(
  companyId: string,
  inventoryItemId: string,
  locationId?: string,
): Promise<number> {
  const db = requireDb();
  const filters = [
    eq(inventoryMovements.companyId, companyId),
    eq(inventoryMovements.inventoryItemId, inventoryItemId),
  ];
  if (locationId) {
    filters.push(eq(inventoryMovements.locationId, locationId));
  }
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${inventoryMovements.quantity}), 0)`,
    })
    .from(inventoryMovements)
    .where(and(...filters));
  return Number(rows[0]?.total ?? '0');
}

/**
 * Bulk on-hand fetch: one row per item with any movement. Used by the
 * /inventory index page to show on-hand columns without N+1.
 * When locationId is provided, restricts to movements at that location.
 */
export async function getOnHandMap(
  companyId: string,
  inventoryItemIds?: string[],
  locationId?: string,
): Promise<Map<string, number>> {
  const db = requireDb();
  const filters = [eq(inventoryMovements.companyId, companyId)];
  if (inventoryItemIds && inventoryItemIds.length > 0) {
    filters.push(inArray(inventoryMovements.inventoryItemId, inventoryItemIds));
  }
  if (locationId) {
    filters.push(eq(inventoryMovements.locationId, locationId));
  }
  const rows = await db
    .select({
      itemId: inventoryMovements.inventoryItemId,
      total: sql<string>`COALESCE(SUM(${inventoryMovements.quantity}), 0)`,
    })
    .from(inventoryMovements)
    .where(and(...filters))
    .groupBy(inventoryMovements.inventoryItemId);

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.itemId, Number(r.total));
  }
  return map;
}

/**
 * Per-location breakdown for one item: Map<locationId, qty>. Used by the
 * inventory item detail page to render the "on-hand by location" panel.
 * Skips locations with zero net qty so the UI doesn't render empty rows.
 * Returns rows for movements that have a location_id set; legacy rows
 * with NULL locationId (pre-backfill anomaly) are grouped under a
 * synthetic 'unassigned' key.
 */
export async function getOnHandByItemAndLocation(
  companyId: string,
  inventoryItemId: string,
): Promise<Map<string | null, number>> {
  const db = requireDb();
  const rows = await db
    .select({
      locationId: inventoryMovements.locationId,
      total: sql<string>`COALESCE(SUM(${inventoryMovements.quantity}), 0)`,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.companyId, companyId),
        eq(inventoryMovements.inventoryItemId, inventoryItemId),
      ),
    )
    .groupBy(inventoryMovements.locationId);

  const map = new Map<string | null, number>();
  for (const r of rows) {
    const qty = Number(r.total);
    if (qty === 0) continue;
    map.set(r.locationId, qty);
  }
  return map;
}

/**
 * List movements for one item, newest first. Used by the item detail page
 * to render the audit history.
 */
export async function listMovementsForItem(
  companyId: string,
  inventoryItemId: string,
  limit = 100,
): Promise<InventoryMovement[]> {
  const db = requireDb();
  return await db
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.companyId, companyId),
        eq(inventoryMovements.inventoryItemId, inventoryItemId),
      ),
    )
    .orderBy(desc(inventoryMovements.occurredAt), desc(inventoryMovements.createdAt))
    .limit(limit);
}
