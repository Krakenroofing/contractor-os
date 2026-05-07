// Async data accessor for cost codes (dual-backend: Postgres or mock store).
//
// Each company has its own `cost_code_libraries` row (KRAKEN_LIBRARY_ID /
// TRB_LIBRARY_ID in demo) plus access to a single read-only Global library
// (GLOBAL_COST_CODE_LIBRARY_ID) seeded with the standard contractor codes
// from `cost-code-defaults.ts`. Listing returns the union; mutations always
// target the company library.

import 'server-only';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { costCodes, costCodeLibraries, type CostCode } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockCostCodes as mockList,
  getMockCostCode as mockGet,
  createMockCostCode as mockCreate,
  updateMockCostCode as mockUpdate,
  getCompanyLibraryId,
  DuplicateCostCodeError,
} from '@/lib/mock-store';
import { GLOBAL_COST_CODE_LIBRARY_ID } from '@/lib/data/cost-code-defaults';

export { DuplicateCostCodeError, GLOBAL_COST_CODE_LIBRARY_ID };

export type CreateCostCodeInput = Pick<CostCode, 'code' | 'description' | 'category'> &
  Partial<Pick<CostCode, 'division' | 'sortOrder' | 'notes'>>;

export type UpdateCostCodeInput = Partial<
  Pick<CostCode, 'description' | 'category' | 'division' | 'sortOrder' | 'isActive' | 'notes'>
>;

/**
 * True if the code lives in the read-only global library — UI should hide
 * edit/toggle controls for these.
 */
export function isGlobalCostCode(code: CostCode): boolean {
  return code.libraryId === GLOBAL_COST_CODE_LIBRARY_ID;
}

/**
 * Stable ordering used by both backends: division first (NULLs last), then
 * sortOrder, then code.
 */
function compareCostCodes(a: CostCode, b: CostCode): number {
  const da = a.division ?? '~~~';
  const db = b.division ?? '~~~';
  if (da !== db) return da.localeCompare(db);
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.code.localeCompare(b.code);
}

export async function listCostCodes(companyId: string): Promise<CostCode[]> {
  const libraryId = getCompanyLibraryId(companyId);
  if (!libraryId) return [];
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(costCodes)
      .where(
        or(
          eq(costCodes.libraryId, libraryId),
          eq(costCodes.libraryId, GLOBAL_COST_CODE_LIBRARY_ID),
        ),
      )
      .orderBy(asc(costCodes.division), asc(costCodes.sortOrder), asc(costCodes.code));
    return rows;
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
      .where(
        and(
          eq(costCodes.id, id),
          or(
            eq(costCodes.libraryId, libraryId),
            eq(costCodes.libraryId, GLOBAL_COST_CODE_LIBRARY_ID),
          ),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

/**
 * Bulk lookup helper for hot paths (estimate / PO line rendering). Returns
 * a Map keyed by id. Searches both the company library and the global library.
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
      .where(
        and(
          or(
            eq(costCodes.libraryId, libraryId),
            eq(costCodes.libraryId, GLOBAL_COST_CODE_LIBRARY_ID),
          ),
          inArray(costCodes.id, ids),
        ),
      );
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
    // Reject collisions in the company library OR the global library so
    // pickers / reports stay unambiguous.
    const existing = await db
      .select({ id: costCodes.id })
      .from(costCodes)
      .where(
        and(
          eq(costCodes.code, input.code),
          or(
            eq(costCodes.libraryId, libraryId),
            eq(costCodes.libraryId, GLOBAL_COST_CODE_LIBRARY_ID),
          ),
        ),
      )
      .limit(1);
    if (existing.length > 0) throw new DuplicateCostCodeError();
    const rows = await db
      .insert(costCodes)
      .values({
        libraryId,
        code: input.code,
        description: input.description,
        category: input.category,
        division: input.division ?? null,
        sortOrder: input.sortOrder ?? 0,
        notes: input.notes ?? null,
      })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

/**
 * Update a cost code that belongs to the company library. Codes from the
 * global library are read-only — passing a global code id returns undefined.
 */
export async function updateCostCode(
  companyId: string,
  id: string,
  patch: UpdateCostCodeInput,
): Promise<CostCode | undefined> {
  const libraryId = getCompanyLibraryId(companyId);
  if (!libraryId) return undefined;
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(costCodes)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(costCodes.id, id), eq(costCodes.libraryId, libraryId)))
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}

/** Convenience helper for the activate/deactivate toggle in the admin UI. */
export async function setCostCodeActive(
  companyId: string,
  id: string,
  isActive: boolean,
): Promise<CostCode | undefined> {
  return updateCostCode(companyId, id, { isActive });
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

export { compareCostCodes };
