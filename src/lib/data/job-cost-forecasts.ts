// Data layer for `job_cost_forecasts`. Upsert-style — there's one row per
// (project, cost_code) at most. Save replaces the existing forecast; clearing
// soft-deletes it.

import 'server-only';
import { and, asc, eq, isNull, sum } from 'drizzle-orm';
import {
  jobCostForecasts,
  type JobCostForecast,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class JobCostingForecastsNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Job cost forecasts require a configured database. Set DATABASE_URL and apply the Phase 2 migration.',
    );
    this.name = 'JobCostingForecastsNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new JobCostingForecastsNotAvailableInDemoError();
  return getDb()!;
}

export type UpsertJobCostForecastInput = {
  companyId: string;
  projectId: string;
  costCodeId: string;
  costToComplete: string;
  notes: string | null;
  riskFlag: boolean;
  updatedByUserId: string | null;
};

export async function listJobCostForecastsForProject(
  companyId: string,
  projectId: string,
): Promise<JobCostForecast[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  try {
    return await db
      .select()
      .from(jobCostForecasts)
      .where(
        and(
          eq(jobCostForecasts.companyId, companyId),
          eq(jobCostForecasts.projectId, projectId),
          isNull(jobCostForecasts.deletedAt),
        ),
      )
      .orderBy(asc(jobCostForecasts.costCodeId));
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === '42P01'
    ) {
      return [];
    }
    throw err;
  }
}

export async function getJobCostForecast(
  companyId: string,
  id: string,
): Promise<JobCostForecast | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(jobCostForecasts)
    .where(
      and(
        eq(jobCostForecasts.id, id),
        eq(jobCostForecasts.companyId, companyId),
        isNull(jobCostForecasts.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Upsert by (project, cost_code). Existing non-deleted row gets updated;
 * otherwise a new row is inserted. The partial unique index makes this
 * race-safe — concurrent inserts collide and the second falls through to
 * an update.
 */
export async function upsertJobCostForecast(
  input: UpsertJobCostForecastInput,
): Promise<JobCostForecast> {
  const db = requireDb();
  const existing = await db
    .select()
    .from(jobCostForecasts)
    .where(
      and(
        eq(jobCostForecasts.companyId, input.companyId),
        eq(jobCostForecasts.projectId, input.projectId),
        eq(jobCostForecasts.costCodeId, input.costCodeId),
        isNull(jobCostForecasts.deletedAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(jobCostForecasts)
      .set({
        costToComplete: input.costToComplete,
        notes: input.notes,
        riskFlag: input.riskFlag,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(jobCostForecasts.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(jobCostForecasts)
    .values(input)
    .returning();
  return row;
}

export async function softDeleteJobCostForecast(
  companyId: string,
  id: string,
): Promise<JobCostForecast | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(jobCostForecasts)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(jobCostForecasts.id, id),
        eq(jobCostForecasts.companyId, companyId),
        isNull(jobCostForecasts.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

// Migration-tolerant: returns 0 if the `job_cost_forecasts` table doesn't
// exist yet (Postgres error code 42P01 = undefined_table). This protects
// the dashboard / projects / reports pages from a 500 when code lands ahead
// of the SQL migration. Once the migration runs, the catch never fires.
export async function sumCostToCompleteForProject(
  companyId: string,
  projectId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  try {
    const rows = await db
      .select({ total: sum(jobCostForecasts.costToComplete).as('total') })
      .from(jobCostForecasts)
      .where(
        and(
          eq(jobCostForecasts.companyId, companyId),
          eq(jobCostForecasts.projectId, projectId),
          isNull(jobCostForecasts.deletedAt),
        ),
      );
    const raw = rows[0]?.total;
    return raw ? Number(raw) : 0;
  } catch (err) {
    // PostgresError exposes `.code`; the postgres-js driver re-throws as
    // a plain object with the same shape.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === '42P01'
    ) {
      return 0;
    }
    throw err;
  }
}
