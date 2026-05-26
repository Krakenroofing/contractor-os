// Async data accessor for cost codes (dual-backend: Postgres or mock store).
//
// Library model — OVERLAY:
//
//   Every company owns one row in `cost_code_libraries` (is_global=false).
//   That row starts empty and is the destination for any custom codes the
//   company creates. Queries here always UNION the company library with the
//   single Global library (id=…099, is_global=true), so the standard ~80
//   contractor cost codes appear in every company's dropdown automatically.
//
//   Mutations (createCostCode / updateCostCode) always target the company
//   library — the global library is read-only.
//
// Lazy provisioning:
//
//   resolveCostCodeLibraryId() ensures the company row exists. On first read
//   for any company that doesn't have one yet, it INSERTs a row with name
//   "<Company> — Cost Codes". A partial unique index on cost_code_libraries
//   (company_id WHERE company_id IS NOT NULL) makes this race-safe; a
//   concurrent INSERT is dropped by ON CONFLICT and we re-SELECT.
//
//   The backfill migration (2026-05-13_cost_code_library_per_company.sql)
//   pre-creates rows for every existing company so the first read doesn't
//   eat a write latency, but lazy provisioning is the safety net for any
//   company that slipped through (e.g. a company created between migration
//   and deploy).

import 'server-only';
import { cache } from 'react';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import {
  companies,
  costCodes,
  costCodeLibraries,
  type CostCode,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockReadableCostCodes as mockList,
  getMockCostCode as mockGet,
  createMockCostCode as mockCreate,
  updateMockCostCode as mockUpdate,
  getCompanyLibraryId as mockGetCompanyLibraryId,
  DuplicateCostCodeError,
} from '@/lib/mock-store';
import { GLOBAL_COST_CODE_LIBRARY_ID } from '@/lib/data/cost-code-defaults';

export { DuplicateCostCodeError, GLOBAL_COST_CODE_LIBRARY_ID };

export type CreateCostCodeInput = Pick<CostCode, 'code' | 'description' | 'category'> &
  Partial<Pick<CostCode, 'division' | 'sortOrder' | 'notes' | 'defaultCost'>>;

export type UpdateCostCodeInput = Partial<
  Pick<
    CostCode,
    | 'description'
    | 'category'
    | 'division'
    | 'sortOrder'
    | 'isActive'
    | 'notes'
    | 'defaultCost'
  >
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

/**
 * Returns the company's cost-code library id, lazily creating the row if
 * needed. Cached per-request via React.cache() so multiple data-layer calls
 * in the same render share one DB hit.
 *
 * In demo mode (no DATABASE_URL) delegates to the mock-store's hardcoded map.
 */
export const resolveCostCodeLibraryId = cache(
  async (companyId: string): Promise<string | undefined> => {
    if (!isDatabaseConfigured()) {
      return mockGetCompanyLibraryId(companyId);
    }
    const db = getDb()!;

    const existing = await db
      .select({ id: costCodeLibraries.id })
      .from(costCodeLibraries)
      .where(eq(costCodeLibraries.companyId, companyId))
      .limit(1);
    if (existing[0]) return existing[0].id;

    // Look up the company name so the new library row has a meaningful label.
    const companyRow = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    const libName = companyRow[0]
      ? `${companyRow[0].name} — Cost Codes`
      : 'Company Cost Codes';

    // No explicit `target` — `onConflictDoNothing()` lets any unique
    // constraint violation drop the insert silently. The only relevant
    // constraint here is the partial unique index
    // cost_code_libraries_company_uniq, so this still ensures one library
    // per company while keeping the codegen simple (Drizzle's target syntax
    // doesn't cleanly express a partial-index WHERE clause).
    const inserted = await db
      .insert(costCodeLibraries)
      .values({ companyId, name: libName, isGlobal: false })
      .onConflictDoNothing()
      .returning({ id: costCodeLibraries.id });
    if (inserted[0]) return inserted[0].id;

    // Conflict path — a concurrent request created the row first. Re-select.
    const after = await db
      .select({ id: costCodeLibraries.id })
      .from(costCodeLibraries)
      .where(eq(costCodeLibraries.companyId, companyId))
      .limit(1);
    return after[0]?.id;
  },
);

export async function listCostCodes(companyId: string): Promise<CostCode[]> {
  if (isDatabaseConfigured()) {
    const libraryId = await resolveCostCodeLibraryId(companyId);
    if (!libraryId) return [];
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
  // Demo path uses the mock-store's synchronous map.
  return mockList(companyId);
}

export async function getCostCode(
  companyId: string,
  id: string,
): Promise<CostCode | undefined> {
  if (isDatabaseConfigured()) {
    const libraryId = await resolveCostCodeLibraryId(companyId);
    if (!libraryId) return undefined;
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
  if (isDatabaseConfigured()) {
    const libraryId = await resolveCostCodeLibraryId(companyId);
    if (!libraryId) return new Map();
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
  if (isDatabaseConfigured()) {
    const libraryId = await resolveCostCodeLibraryId(companyId);
    if (!libraryId) throw new Error('No cost code library for company');
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
        defaultCost: input.defaultCost ?? null,
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
  if (isDatabaseConfigured()) {
    const libraryId = await resolveCostCodeLibraryId(companyId);
    if (!libraryId) return undefined;
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
