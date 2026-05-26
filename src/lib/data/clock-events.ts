// Clock event data layer. Mirrors the time_entries / receipts shape:
// DB-only (no in-memory mock — clock punches aren't useful in demo).

import 'server-only';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
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
