// Async data accessor for vendors (dual-backend: Postgres or mock store).

import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { vendors, type Vendor } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockVendors as mockList,
  getMockVendor as mockGet,
  createMockVendor as mockCreate,
  updateMockVendor as mockUpdate,
  softDeleteMockVendor as mockSoftDelete,
  type CreateVendorInput,
} from '@/lib/mock-store';

export type { CreateVendorInput };
export type UpdateVendorInput = Partial<CreateVendorInput>;

export async function listVendors(companyId: string): Promise<Vendor[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.companyId, companyId), isNull(vendors.deletedAt)))
      .orderBy(asc(vendors.name));
  }
  return mockList(companyId);
}

export async function getVendor(
  companyId: string,
  id: string,
): Promise<Vendor | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(vendors)
      .where(
        and(
          eq(vendors.id, id),
          eq(vendors.companyId, companyId),
          isNull(vendors.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

/** Case- and whitespace-insensitive lookup of an ACTIVE vendor by name —
 *  the duplicate guard for create/rename ("Quality Convenience Store" must
 *  exist once, however it's typed). */
export async function findActiveVendorByName(
  companyId: string,
  name: string,
): Promise<Vendor | undefined> {
  if (!isDatabaseConfigured()) {
    const norm = name.trim().toLowerCase();
    return (await mockList(companyId)).find(
      (v) => v.name.trim().toLowerCase() === norm,
    );
  }
  const db = getDb()!;
  const rows = await db
    .select()
    .from(vendors)
    .where(
      and(
        eq(vendors.companyId, companyId),
        isNull(vendors.deletedAt),
        sql`LOWER(TRIM(${vendors.name})) = LOWER(TRIM(${name}))`,
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createVendor(
  companyId: string,
  input: CreateVendorInput,
): Promise<Vendor> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(vendors)
      .values({ ...input, companyId })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

export async function updateVendor(
  companyId: string,
  id: string,
  patch: UpdateVendorInput,
): Promise<Vendor | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(vendors)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(vendors.id, id),
          eq(vendors.companyId, companyId),
          isNull(vendors.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}

/**
 * Soft-delete a vendor. PO history references vendors, so we never
 * hard-delete — just stop showing them in lists.
 */
export async function softDeleteVendor(
  companyId: string,
  id: string,
): Promise<Vendor | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const now = new Date();
    const rows = await db
      .update(vendors)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(vendors.id, id),
          eq(vendors.companyId, companyId),
          isNull(vendors.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockSoftDelete(companyId, id);
}
