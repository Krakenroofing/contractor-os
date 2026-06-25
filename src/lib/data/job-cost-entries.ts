// Data layer for `job_cost_entries`. Phase 1 surface: create / list / update /
// soft-delete + sum helpers for the financials roll-ups.
//
// Demo-mode behaviour: when DATABASE_URL is not set, this module deliberately
// returns empty arrays / no-ops (matches the daily-reports + project-documents
// pattern). The existing mock-store has a separate `jobCostEntries` array
// that's always empty, so demo mode keeps rendering "no cost data entered".

import 'server-only';
import { and, asc, desc, eq, isNull, sql, sum } from 'drizzle-orm';
import {
  jobCostEntries,
  type JobCostEntry,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class JobCostingNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Job Costing requires a configured database. Set DATABASE_URL and apply the job_cost_entries migration to use this module.',
    );
    this.name = 'JobCostingNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new JobCostingNotAvailableInDemoError();
  return getDb()!;
}

export type CreateJobCostEntryInput = Omit<
  JobCostEntry,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export type UpdateJobCostEntryInput = Partial<
  Pick<
    JobCostEntry,
    | 'costCodeId'
    | 'costType'
    | 'vendorId'
    | 'entryDate'
    | 'description'
    | 'quantity'
    | 'unitCost'
    | 'amount'
    // The P&L expense category (COGS/OpEx account). Re-categorizing a posted
    // entry moves it between P&L lines without a void + re-post.
    | 'accountingAccountId'
    | 'isBillable'
    | 'markupPercent'
    | 'notes'
    | 'attachmentUrl'
  >
>;

export async function listJobCostEntriesForProject(
  companyId: string,
  projectId: string,
): Promise<JobCostEntry[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return withMigrationFallback(
    () =>
      db
        .select()
        .from(jobCostEntries)
        .where(
          and(
            eq(jobCostEntries.companyId, companyId),
            eq(jobCostEntries.projectId, projectId),
            isNull(jobCostEntries.deletedAt),
          ),
        )
        .orderBy(desc(jobCostEntries.entryDate), desc(jobCostEntries.createdAt)),
    [] as JobCostEntry[],
  );
}

/** Company-wide list for the reconciliation matcher. Capped for safety. */
export async function listAllJobCostEntriesForCompany(
  companyId: string,
  options: { limit?: number } = {},
): Promise<JobCostEntry[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return withMigrationFallback(
    () =>
      db
        .select()
        .from(jobCostEntries)
        .where(
          and(
            eq(jobCostEntries.companyId, companyId),
            isNull(jobCostEntries.deletedAt),
          ),
        )
        .orderBy(desc(jobCostEntries.entryDate), desc(jobCostEntries.createdAt))
        .limit(options.limit ?? 2000),
    [] as JobCostEntry[],
  );
}

export async function getJobCostEntry(
  companyId: string,
  id: string,
): Promise<JobCostEntry | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(jobCostEntries)
    .where(
      and(
        eq(jobCostEntries.id, id),
        eq(jobCostEntries.companyId, companyId),
        isNull(jobCostEntries.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createJobCostEntry(
  input: CreateJobCostEntryInput,
): Promise<JobCostEntry> {
  const db = requireDb();
  const [row] = await db.insert(jobCostEntries).values(input).returning();
  return row;
}

export async function updateJobCostEntry(
  companyId: string,
  id: string,
  patch: UpdateJobCostEntryInput,
): Promise<JobCostEntry | undefined> {
  const db = requireDb();
  const rows = await db
    .update(jobCostEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(jobCostEntries.id, id),
        eq(jobCostEntries.companyId, companyId),
        isNull(jobCostEntries.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function softDeleteJobCostEntry(
  companyId: string,
  id: string,
): Promise<JobCostEntry | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(jobCostEntries)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(jobCostEntries.id, id),
        eq(jobCostEntries.companyId, companyId),
        isNull(jobCostEntries.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

// ---------------------------------------------------------------------------
// Aggregations consumed by computeProjectFinancials & breakdowns.
// All sums use SQL aggregation so they stay O(1) regardless of entry count.
//
// Migration tolerance: wrapped in `withMigrationFallback` to return 0/[] if
// the Phase 1 migration hasn't added the new columns yet (42703 =
// undefined_column). The dashboard fans out through computeProjectFinancials
// across every project, so a missing column would otherwise crash the
// homepage between deploy and migration.
// ---------------------------------------------------------------------------

function isMissingTableOrColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  const code = (err as { code: unknown }).code;
  // 42P01 = undefined_table, 42703 = undefined_column
  return code === '42P01' || code === '42703';
}

async function withMigrationFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingTableOrColumnError(err)) return fallback;
    throw err;
  }
}

export async function sumManualActualForProject(
  companyId: string,
  projectId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  return withMigrationFallback(async () => {
    const rows = await db
      .select({ total: sum(jobCostEntries.amount).as('total') })
      .from(jobCostEntries)
      .where(
        and(
          eq(jobCostEntries.companyId, companyId),
          eq(jobCostEntries.projectId, projectId),
          isNull(jobCostEntries.deletedAt),
        ),
      );
    const raw = rows[0]?.total;
    return raw ? Number(raw) : 0;
  }, 0);
}

export type ActualByCostCode = { costCodeId: string; actual: number };

export async function sumActualByCostCodeForProject(
  companyId: string,
  projectId: string,
): Promise<ActualByCostCode[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return withMigrationFallback(async () => {
    const rows = await db
      .select({
        costCodeId: jobCostEntries.costCodeId,
        total: sum(jobCostEntries.amount).as('total'),
      })
      .from(jobCostEntries)
      .where(
        and(
          eq(jobCostEntries.companyId, companyId),
          eq(jobCostEntries.projectId, projectId),
          isNull(jobCostEntries.deletedAt),
        ),
      )
      .groupBy(jobCostEntries.costCodeId);
    return rows.map((r) => ({
      costCodeId: r.costCodeId,
      actual: r.total ? Number(r.total) : 0,
    }));
  }, []);
}

export type ActualByCostType = { costType: JobCostEntry['costType']; actual: number };

export async function sumActualByCostTypeForProject(
  companyId: string,
  projectId: string,
): Promise<ActualByCostType[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return withMigrationFallback(async () => {
    const rows = await db
      .select({
        costType: jobCostEntries.costType,
        total: sum(jobCostEntries.amount).as('total'),
      })
      .from(jobCostEntries)
      .where(
        and(
          eq(jobCostEntries.companyId, companyId),
          eq(jobCostEntries.projectId, projectId),
          isNull(jobCostEntries.deletedAt),
        ),
      )
      .groupBy(jobCostEntries.costType)
      .orderBy(asc(jobCostEntries.costType));
    return rows.map((r) => ({
      costType: r.costType,
      actual: r.total ? Number(r.total) : 0,
    }));
  }, []);
}

export async function countJobCostEntriesForProject(
  companyId: string,
  projectId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobCostEntries)
    .where(
      and(
        eq(jobCostEntries.companyId, companyId),
        eq(jobCostEntries.projectId, projectId),
        isNull(jobCostEntries.deletedAt),
      ),
    );
  return rows[0]?.n ?? 0;
}
