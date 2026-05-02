// Async data accessor for vendors (dual-backend: Postgres or mock store).

import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { vendors, type Vendor } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockVendors as mockList,
  getMockVendor as mockGet,
  createMockVendor as mockCreate,
  type CreateVendorInput,
} from '@/lib/mock-store';

export type { CreateVendorInput };

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
