// Clock event data layer. Mirrors the time_entries / receipts shape:
// DB-only (no in-memory mock — clock punches aren't useful in demo).

import 'server-only';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  clockEvents,
  type ClockEvent,
  type ClockEventKind,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type CreateClockEventInput = {
  companyId: string;
  employeeId: string;
  projectId: string | null;
  costCodeId: string | null;
  kind: ClockEventKind;
  occurredAt: Date;
  gpsLat: string | null;
  gpsLng: string | null;
  gpsAccuracyM: string | null;
  notes: string | null;
};

export async function recordClockEvent(
  input: CreateClockEventInput,
): Promise<ClockEvent> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Clock events require a configured database. Set DATABASE_URL.',
    );
  }
  const db = getDb()!;
  const rows = await db
    .insert(clockEvents)
    .values({
      companyId: input.companyId,
      employeeId: input.employeeId,
      projectId: input.projectId,
      costCodeId: input.costCodeId,
      kind: input.kind,
      occurredAt: input.occurredAt,
      gpsLat: input.gpsLat,
      gpsLng: input.gpsLng,
      gpsAccuracyM: input.gpsAccuracyM,
      notes: input.notes,
    })
    .returning();
  return rows[0];
}

/**
 * Most recent clock event for this employee. The current clock state is
 * derived from `kind`: 'in' = currently working, 'out' or null = not.
 * Used by /field on every load — the composite index on
 * (employee_id, occurred_at desc) makes this a single seek.
 */
export async function getLatestClockEvent(
  employeeId: string,
): Promise<ClockEvent | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(clockEvents)
    .where(eq(clockEvents.employeeId, employeeId))
    .orderBy(desc(clockEvents.occurredAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * All clock events for an employee within a day window (inclusive start,
 * exclusive end). Used by the day-summary table on /field/clock.
 *
 * The caller passes pre-computed Date boundaries to avoid timezone
 * surprises — we never derive "today" inside the query layer because the
 * server's TZ may not match the user's.
 */
export async function listClockEventsForEmployeeRange(
  employeeId: string,
  start: Date,
  end: Date,
): Promise<ClockEvent[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(clockEvents)
    .where(
      and(
        eq(clockEvents.employeeId, employeeId),
        gte(clockEvents.occurredAt, start),
        lte(clockEvents.occurredAt, end),
      ),
    )
    .orderBy(clockEvents.occurredAt);
}

/**
 * All clock events across every employee in a company within a window.
 * Used by the office review page to render the day grid. Sorted by
 * employee, then occurredAt, so the caller can `pairClockSessions` on
 * each per-employee slice without re-sorting.
 */
export async function listClockEventsForCompanyRange(
  companyId: string,
  start: Date,
  end: Date,
): Promise<ClockEvent[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(clockEvents)
    .where(
      and(
        eq(clockEvents.companyId, companyId),
        gte(clockEvents.occurredAt, start),
        lte(clockEvents.occurredAt, end),
      ),
    )
    .orderBy(asc(clockEvents.employeeId), asc(clockEvents.occurredAt));
}

/**
 * Employees currently on the clock company-wide: their latest punch is
 * an 'in'. Returns the latest punch per employee. Two-step lookup —
 * latest occurredAt per employee, then the row at that timestamp — keeps
 * the index-only seek path on the (employee_id, occurred_at desc) index.
 */
export async function listOpenSessionsForCompany(
  companyId: string,
): Promise<ClockEvent[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db.execute<{
    id: string;
    company_id: string;
    employee_id: string;
    project_id: string | null;
    cost_code_id: string | null;
    kind: string;
    occurred_at: Date;
    gps_lat: string | null;
    gps_lng: string | null;
    gps_accuracy_m: string | null;
    notes: string | null;
    reviewed_at: Date | null;
    reviewed_by: string | null;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (employee_id) *
    FROM clock_events
    WHERE company_id = ${companyId}
    ORDER BY employee_id, occurred_at DESC
  `);
  // drizzle's execute returns snake_case keys; remap to the camelCase
  // shape the rest of the app expects (matches ClockEvent inferred type).
  return rows
    .filter((r) => r.kind === 'in')
    .map((r) => ({
      id: r.id,
      companyId: r.company_id,
      employeeId: r.employee_id,
      projectId: r.project_id,
      costCodeId: r.cost_code_id,
      kind: r.kind,
      occurredAt: new Date(r.occurred_at),
      gpsLat: r.gps_lat,
      gpsLng: r.gps_lng,
      gpsAccuracyM: r.gps_accuracy_m,
      notes: r.notes,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
      reviewedBy: r.reviewed_by,
      createdAt: new Date(r.created_at),
    }));
}

export async function getClockEvent(
  companyId: string,
  id: string,
): Promise<ClockEvent | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(clockEvents)
    .where(and(eq(clockEvents.companyId, companyId), eq(clockEvents.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export type UpdateClockEventInput = {
  occurredAt?: Date;
  projectId?: string | null;
  costCodeId?: string | null;
  notes?: string | null;
};

/**
 * Edit a punch. Any edit clears `reviewed_at` so the session has to be
 * re-reviewed before M6.2 will post it — prevents accidentally
 * back-dating an approved punch into payroll.
 */
export async function updateClockEvent(
  companyId: string,
  id: string,
  patch: UpdateClockEventInput,
): Promise<ClockEvent | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const rows = await db
    .update(clockEvents)
    .set({
      ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.costCodeId !== undefined ? { costCodeId: patch.costCodeId } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      reviewedAt: null,
      reviewedBy: null,
    })
    .where(and(eq(clockEvents.companyId, companyId), eq(clockEvents.id, id)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteClockEvent(
  companyId: string,
  id: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .delete(clockEvents)
    .where(and(eq(clockEvents.companyId, companyId), eq(clockEvents.id, id)));
}

/**
 * Mark a set of punches reviewed. Called with both the in and out rows
 * of a paired session (or just the in row for an open session — but
 * post-to-payroll in M6.2 will refuse to post an open session anyway).
 */
export async function markPunchesReviewed(
  companyId: string,
  ids: string[],
  reviewerUserId: string,
): Promise<void> {
  if (!isDatabaseConfigured() || ids.length === 0) return;
  const db = getDb()!;
  await db
    .update(clockEvents)
    .set({ reviewedAt: new Date(), reviewedBy: reviewerUserId })
    .where(
      and(
        eq(clockEvents.companyId, companyId),
        sql`${clockEvents.id} = ANY(${ids}::uuid[])`,
      ),
    );
}

export async function unmarkPunchesReviewed(
  companyId: string,
  ids: string[],
): Promise<void> {
  if (!isDatabaseConfigured() || ids.length === 0) return;
  const db = getDb()!;
  await db
    .update(clockEvents)
    .set({ reviewedAt: null, reviewedBy: null })
    .where(
      and(
        eq(clockEvents.companyId, companyId),
        sql`${clockEvents.id} = ANY(${ids}::uuid[])`,
      ),
    );
}

/**
 * Pair adjacent (in → out) events into sessions. A dangling 'in' at the
 * end is returned with `out=null` — the UI flags it as "still on the clock".
 * Stray 'out' events without a matching 'in' are dropped (defensive: this
 * shouldn't happen unless an admin deletes events out of order).
 *
 * Assumes the input is already sorted ascending by occurredAt.
 */
export function pairClockSessions(
  events: ClockEvent[],
): Array<{ in: ClockEvent; out: ClockEvent | null }> {
  const sessions: Array<{ in: ClockEvent; out: ClockEvent | null }> = [];
  let openIn: ClockEvent | null = null;
  for (const e of events) {
    if (e.kind === 'in') {
      // Two ins in a row → close the prior dangling one as its own session
      // (no matching out yet) before starting the new one.
      if (openIn) sessions.push({ in: openIn, out: null });
      openIn = e;
    } else if (e.kind === 'out') {
      if (openIn) {
        sessions.push({ in: openIn, out: e });
        openIn = null;
      }
      // Else: orphan out, ignore.
    }
  }
  if (openIn) sessions.push({ in: openIn, out: null });
  return sessions;
}
