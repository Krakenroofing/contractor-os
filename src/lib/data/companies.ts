// Async data accessor for companies.
//
// Dual-backend:
//   - DATABASE_URL set → Drizzle / Postgres
//   - DATABASE_URL unset → in-memory mock store (the same data the demo has
//     always served, kept for fallback / offline development)
//
// Existing call sites import the legacy synchronous `listMockCompanies` /
// `getMockCompany` from '@/lib/mock-store'. Migrate them to import the names
// below and `await` the result.

import 'server-only';
import { eq } from 'drizzle-orm';
import { companies, type Company } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockCompanies as mockList,
  getMockCompany as mockGet,
  updateMockCompany as mockUpdate,
} from '@/lib/mock-store';

export async function listCompanies(): Promise<Company[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db.select().from(companies).orderBy(companies.name);
  }
  return mockList();
}

export async function getCompany(id: string): Promise<Company | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(companies)
      .where(eq(companies.id, id))
      .limit(1);
    return rows[0];
  }
  return mockGet(id);
}

export async function updateCompany(
  id: string,
  patch: Partial<Omit<Company, 'id' | 'slug' | 'createdAt'>>,
): Promise<Company | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(companies)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return rows[0];
  }
  return mockUpdate(id, patch);
}
