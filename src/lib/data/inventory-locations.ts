// Data layer for inventory_locations (Phase 6.4).
//
// Soft-delete: locations with movement history can't be hard-deleted
// without losing the audit trail, so archive (archived_at). The default
// location flag is enforced by a partial unique index — only one
// (is_default = true, archived_at IS NULL) row per company.

import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  inventoryLocations,
  type InventoryLocation,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'inventory_locations requires a configured database — demo mode is not supported.',
    );
  }
  return getDb()!;
}

export async function listInventoryLocations(
  companyId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<InventoryLocation[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const filters = [eq(inventoryLocations.companyId, companyId)];
  if (!opts.includeArchived) filters.push(isNull(inventoryLocations.archivedAt));
  return await db
    .select()
    .from(inventoryLocations)
    .where(and(...filters))
    .orderBy(asc(inventoryLocations.name));
}

export async function getInventoryLocation(
  companyId: string,
  id: string,
): Promise<InventoryLocation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.id, id),
        eq(inventoryLocations.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Return the active default location for a company, or null. The migration
 * seeds a "Main Yard" default per company, so this should never return
 * null in practice unless the operator explicitly archived all locations.
 */
export async function getDefaultLocation(
  companyId: string,
): Promise<InventoryLocation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.companyId, companyId),
        eq(inventoryLocations.isDefault, true),
        isNull(inventoryLocations.archivedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createInventoryLocation(
  companyId: string,
  input: { name: string; notes?: string | null; isDefault?: boolean },
): Promise<InventoryLocation> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    if (input.isDefault) {
      // Clear any existing default first so the partial unique index
      // doesn't conflict.
      await tx
        .update(inventoryLocations)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(inventoryLocations.companyId, companyId),
            eq(inventoryLocations.isDefault, true),
            isNull(inventoryLocations.archivedAt),
          ),
        );
    }
    const [row] = await tx
      .insert(inventoryLocations)
      .values({
        companyId,
        name: input.name.trim(),
        notes: input.notes?.trim() || null,
        isDefault: input.isDefault ?? false,
      })
      .returning();
    return row;
  });
}

export async function setDefaultLocation(
  companyId: string,
  id: string,
): Promise<void> {
  const db = requireDb();
  await db.transaction(async (tx) => {
    await tx
      .update(inventoryLocations)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryLocations.companyId, companyId),
          eq(inventoryLocations.isDefault, true),
          isNull(inventoryLocations.archivedAt),
        ),
      );
    await tx
      .update(inventoryLocations)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryLocations.id, id),
          eq(inventoryLocations.companyId, companyId),
        ),
      );
  });
}

export async function archiveInventoryLocation(
  companyId: string,
  id: string,
): Promise<void> {
  const db = requireDb();
  // Don't allow archiving if it's the current default — operator must
  // pick a new default first. The action layer surfaces this error.
  const current = await getInventoryLocation(companyId, id);
  if (current?.isDefault) {
    throw new Error(
      'Cannot archive the default location. Set another location as default first.',
    );
  }
  await db
    .update(inventoryLocations)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(inventoryLocations.id, id),
        eq(inventoryLocations.companyId, companyId),
      ),
    );
}

export async function unarchiveInventoryLocation(
  companyId: string,
  id: string,
): Promise<void> {
  const db = requireDb();
  await db
    .update(inventoryLocations)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryLocations.id, id),
        eq(inventoryLocations.companyId, companyId),
      ),
    );
}
