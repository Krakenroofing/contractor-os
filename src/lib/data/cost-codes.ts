// Async data accessor for cost codes (dual-backend: Postgres or mock store).
//
// Cost codes belong to a `cost_code_library`. Each company has exactly one
// library in the demo (KRAKEN_LIBRARY_ID / TRB_LIBRARY_ID). The mapping is
// kept in sync between modes via the LIBRARY_BY_COMPANY map exposed by the
// mock store; the seed script ensures both rows are present in Postgres.

import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { costCodes, costCodeLibraries, type CostCode } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockCostCodes as mockList,
  getMockCostCode as mockGet,
  createMockCostCode as mockCreate,
  getCompanyLibraryId,
  DuplicateCostCodeError,
} from '@/lib/mock-store';

export { DuplicateCostCodeError };

export type CreateCostCodeInput = Pick<
  CostCode,
  'code' | 'description' | 'category'
>;

export async function listCostCodes(companyId: string): Promise<CostCode[]> {
  const libraryId = getCompanyLibraryId(companyId);
  if (!libraryId) return [];
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(costCodes)
      .where(eq(costCodes.libraryId, libraryId))
      .orderBy(asc(costCodes.code));
  }
  return mockList(companyId);
}

export async function getCostCode(
  companyId: string,
  id: string,
): Promise<CostCode | undefined> {
  const libraryId = getCompanyLibraryId(companyId);
  if (!libraryId) return undefined;
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(costCodes)
      .where(and(eq(costCodes.id, id), eq(costCodes.libraryId, libraryId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

/**
 * Helper for hot loops that need to look up many cost codes at once.
 * Returns a Map keyed by id for O(1) lookups.
 */
export async function loadCostCodeMap(
  companyId: string,
  ids: string[],
): Promise<Map<string, CostCode>> {
  if (ids.length === 0) return new Map();
  const libraryId = getCompanyLibraryId(companyId);
  if (!libraryId) return new Map();
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(costCodes)
      .where(and(eq(costCodes.libraryId, libraryId), inArray(costCodes.id, ids)));
    return new Map(rows.map((r) => [r.id, r]));
  }
  const map = new Map<string, CostCode>();
  for (const id of ids) {
    const cc = mockGet(companyId, id);
    if (cc) map.set(id, cc);
  }
  return map;
}

export async function createCostCode(
  companyId: string,
  input: CreateCostCodeInput,
): Promise<CostCode> {
  const libraryId = getCompanyLibraryId(companyId);
  if (!libraryId) throw new Error('No cost code library for company');
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Mirror the mock-store's library+code uniqueness contract.
    const existing = await db
      .select({ id: costCodes.id })
      .from(costCodes)
      .where(and(eq(costCodes.libraryId, libraryId), eq(costCodes.code, input.code)))
      .limit(1);
    if (existing.length > 0) throw new DuplicateCostCodeError();
    const rows = await db
      .insert(costCodes)
      .values({ ...input, libraryId })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

/**
 * Ensure both demo cost-code libraries exist in the database. Called by the
 * seed script before inserting cost codes (which require a library FK).
 */
export async function ensureDemoLibraries(libs: { id: string; companyId: string; name: string }[]) {
  const db = getDb();
  if (!db) return;
  if (libs.length === 0) return;
  await db
    .insert(costCodeLibraries)
    .values(libs.map((l) => ({ ...l, isGlobal: false })))
    .onConflictDoNothing();
}
