// Clock event data layer. Mirrors the time_entries / receipts shape:
// DB-only (no in-memory mock — clock punches aren't useful in demo).

import 'server-only';
import { and, asc, desc, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm';
import {
  clockEvents,
  timeEntries,
  type ClockEvent,
  type ClockEventKind,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { getOrCreatePeriodForDate } from '@/lib/data/pay-periods';
import {
  endOfDayInTZ,
  formatTimeInTZ,
  startOfDayInTZ,
  todayISOInTZ,
} from '@/lib/tz';

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
    posted_time_entry_id: string | null;
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
      postedTimeEntryId: r.posted_time_entry_id,
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

export class PunchAlreadyPostedError extends Error {
  constructor(message = 'This punch has already been posted to payroll. Delete the time entry on /payroll first to make further changes.') {
    super(message);
    this.name = 'PunchAlreadyPostedError';
  }
}

/**
 * Edit a punch. Any edit clears `reviewed_at` so the session has to be
 * re-reviewed before M6.2 will re-post it. Refuses to touch a posted
 * punch — admins must delete the resulting time entry first (which
 * cascades posted_time_entry_id back to NULL via ON DELETE SET NULL).
 */
export async function updateClockEvent(
  companyId: string,
  id: string,
  patch: UpdateClockEventInput,
): Promise<ClockEvent | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const existing = await getClockEvent(companyId, id);
  if (!existing) return null;
  if (existing.postedTimeEntryId) throw new PunchAlreadyPostedError();
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

/**
 * Raised when an open session can't be closed from the office: the IN
 * punch is no longer the employee's latest event (already closed, or a
 * newer punch landed), or the requested clock-out time isn't after the
 * clock-in. Carries a user-facing message the action surfaces inline.
 */
export class CannotCloseSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CannotCloseSessionError';
  }
}

export type SessionCloseInfo = {
  inEvent: ClockEvent;
  /** Open in the same sense the /clock day grid shows (paired within day). */
  isOpen: boolean;
  /** Employee's next clock-IN after this one (any day) — upper bound for OUT. */
  nextInAt: Date | null;
  /** The IN's Nassau day (YYYY-MM-DD), for routing back to the day grid. */
  inDayISO: string;
};

/**
 * Inspect an IN punch for the "close open session" flow.
 *
 * "Open" mirrors the /clock day grid exactly: pair the employee's punches
 * *within the IN's Nassau day* and check this IN has no OUT. A clock-out
 * that lands on a LATER day (e.g. the worker punched out the next morning,
 * or re-punched and left a stray OUT) does NOT count — the session still
 * reads as open for its own day, which is precisely the case the office
 * needs to fix.
 *
 * `nextInAt` is the employee's next clock-IN after this one (any day). It
 * bounds where the recorded OUT may land: at/after it we'd scramble the
 * next session's pairing. Any stray OUT sitting before that next IN is
 * demoted to a harmless orphan once the real OUT is inserted earlier.
 */
export async function getSessionCloseInfo(
  companyId: string,
  inId: string,
): Promise<SessionCloseInfo | null> {
  if (!isDatabaseConfigured()) return null;
  const inEvent = await getClockEvent(companyId, inId);
  if (!inEvent) return null;
  const inDayISO = todayISOInTZ(inEvent.occurredAt);

  if (inEvent.kind !== 'in' || inEvent.postedTimeEntryId) {
    return { inEvent, isOpen: false, nextInAt: null, inDayISO };
  }

  // Pair within the IN's own Nassau day — same logic the grid renders.
  const start = startOfDayInTZ(inEvent.occurredAt);
  const end = endOfDayInTZ(inEvent.occurredAt);
  const dayEvents = await listClockEventsForEmployeeRange(
    inEvent.employeeId,
    start,
    end,
  );
  const session = pairClockSessions(dayEvents).find((s) => s.in.id === inId);
  const isOpen = Boolean(session && session.out === null);

  // Next clock-IN after this one (any day) — upper bound for the OUT.
  const db = getDb()!;
  const nextIns = await db
    .select()
    .from(clockEvents)
    .where(
      and(
        eq(clockEvents.employeeId, inEvent.employeeId),
        eq(clockEvents.kind, 'in'),
        gt(clockEvents.occurredAt, inEvent.occurredAt),
      ),
    )
    .orderBy(asc(clockEvents.occurredAt))
    .limit(1);
  const nextInAt = nextIns[0]?.occurredAt ?? null;

  return { inEvent, isOpen, nextInAt, inDayISO };
}

/**
 * Close an open session by recording its missing OUT punch — the office
 * fix for "worker forgot to clock out." `inId` is the dangling IN punch.
 *
 * Guards (see getSessionCloseInfo for the open/next-in semantics):
 *  - the IN must be an unposted clock-in that the day grid shows as open,
 *  - the OUT must be after the IN, and
 *  - the OUT must be before the worker's next clock-in (so we don't
 *    scramble a later session's pairing).
 *
 * The new OUT copies the IN's project/cost code so the pair stays
 * consistent (posting reads the IN, but we keep them in sync — same
 * rationale as setSessionProjectAction). Inserting the OUT before any
 * stray later OUT demotes that stray to an orphan, which pairClockSessions
 * drops. Returns the created OUT plus the IN's Nassau day for routing.
 */
export async function recordSessionClockOut(
  companyId: string,
  inId: string,
  occurredAt: Date,
  notes: string | null = null,
): Promise<{ out: ClockEvent; inDayISO: string }> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Clock events require a configured database. Set DATABASE_URL.',
    );
  }
  const info = await getSessionCloseInfo(companyId, inId);
  if (!info) {
    throw new CannotCloseSessionError('That clock-in no longer exists.');
  }
  const { inEvent, isOpen, nextInAt, inDayISO } = info;
  if (inEvent.kind !== 'in') {
    throw new CannotCloseSessionError('That punch is not a clock-in.');
  }
  if (inEvent.postedTimeEntryId) {
    throw new CannotCloseSessionError(
      'This session has already posted to payroll.',
    );
  }
  if (!isOpen) {
    throw new CannotCloseSessionError(
      'This session already has a clock-out for that day.',
    );
  }
  if (occurredAt.getTime() <= inEvent.occurredAt.getTime()) {
    throw new CannotCloseSessionError(
      'Clock-out time must be after the clock-in time.',
    );
  }
  if (nextInAt && occurredAt.getTime() >= nextInAt.getTime()) {
    throw new CannotCloseSessionError(
      `Clock-out must be before this worker's next clock-in (${formatTimeInTZ(
        nextInAt,
      )}).`,
    );
  }
  const out = await recordClockEvent({
    companyId,
    employeeId: inEvent.employeeId,
    projectId: inEvent.projectId,
    costCodeId: inEvent.costCodeId,
    kind: 'out',
    occurredAt,
    gpsLat: null,
    gpsLng: null,
    gpsAccuracyM: null,
    notes,
  });
  return { out, inDayISO };
}

export async function deleteClockEvent(
  companyId: string,
  id: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const existing = await getClockEvent(companyId, id);
  if (!existing) return;
  if (existing.postedTimeEntryId) throw new PunchAlreadyPostedError();
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

export type PostableSession = { in: ClockEvent; out: ClockEvent };

/**
 * Reviewed-and-unposted paired sessions across all employees in the
 * company. Open (unpaired) and unreviewed sessions are excluded — only
 * complete, signed-off sessions are eligible to post.
 *
 * Implementation: pull every UNPOSTED event for the company, group by
 * employee, pair, then keep pairs where both punches carry reviewed_at.
 * Posted events are excluded from the input so pairing can't span a
 * previously-posted session.
 */
export async function listPostableSessions(
  companyId: string,
): Promise<PostableSession[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select()
    .from(clockEvents)
    .where(
      and(
        eq(clockEvents.companyId, companyId),
        isNull(clockEvents.postedTimeEntryId),
      ),
    )
    .orderBy(asc(clockEvents.employeeId), asc(clockEvents.occurredAt));

  const byEmployee = new Map<string, ClockEvent[]>();
  for (const e of rows) {
    const list = byEmployee.get(e.employeeId) ?? [];
    list.push(e);
    byEmployee.set(e.employeeId, list);
  }
  const out: PostableSession[] = [];
  for (const events of byEmployee.values()) {
    const sessions = pairClockSessions(events);
    for (const s of sessions) {
      if (s.out && s.in.reviewedAt && s.out.reviewedAt) {
        out.push({ in: s.in, out: s.out });
      }
    }
  }
  return out;
}

export type PostResult = {
  posted: number;
  skippedLocked: number;
  skippedOther: number;
};

/**
 * Post a batch of reviewed sessions to time_entries. One time_entries
 * row per session. Skips sessions whose pay period is locked (close-out
 * already happened — re-opening the period is an explicit action on
 * /payroll). On transient errors, skips the offending session and keeps
 * going so a single bad punch doesn't poison the whole batch.
 */
export async function postSessionsToTimeEntries(
  companyId: string,
  sessions: PostableSession[],
): Promise<PostResult> {
  if (!isDatabaseConfigured() || sessions.length === 0) {
    return { posted: 0, skippedLocked: 0, skippedOther: 0 };
  }
  const db = getDb()!;
  let posted = 0;
  let skippedLocked = 0;
  let skippedOther = 0;

  // Many sessions on the same Nassau date share a pay period — cache
  // by workDate so we don't hammer getOrCreatePeriodForDate per row.
  const periodCache = new Map<string, { id: string; status: string }>();
  async function periodFor(workDate: string) {
    let cached = periodCache.get(workDate);
    if (!cached) {
      const p = await getOrCreatePeriodForDate(companyId, workDate);
      cached = { id: p.id, status: p.status };
      periodCache.set(workDate, cached);
    }
    return cached;
  }

  for (const s of sessions) {
    try {
      // Anchor the time-entries.work_date to the IN punch's Nassau day.
      // Midnight-crossing sessions are deferred to M6.2.1 — they'll
      // just land on the IN day's row for now.
      const workDate = todayISOInTZ(s.in.occurredAt);
      const period = await periodFor(workDate);
      if (period.status === 'locked') {
        skippedLocked += 1;
        continue;
      }
      const ms = s.out.occurredAt.getTime() - s.in.occurredAt.getTime();
      const hoursNum = Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);
      const notesParts = [s.in.notes, s.out.notes].filter(
        (n): n is string => !!n,
      );
      const notes = notesParts.length ? notesParts.join(' / ') : null;

      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(timeEntries)
          .values({
            companyId,
            employeeId: s.in.employeeId,
            payPeriodId: period.id,
            workDate,
            entryType: 'hours',
            hours: hoursNum.toFixed(2),
            amount: '0',
            projectId: s.in.projectId,
            costCodeId: s.in.costCodeId,
            isOverhead: s.in.projectId == null,
            notes,
          })
          .returning({ id: timeEntries.id });
        await tx
          .update(clockEvents)
          .set({ postedTimeEntryId: inserted.id })
          .where(
            and(
              eq(clockEvents.companyId, companyId),
              sql`${clockEvents.id} = ANY(${[s.in.id, s.out.id]}::uuid[])`,
            ),
          );
      });
      posted += 1;
    } catch {
      // Don't let one bad session block the rest of the batch — the
      // count gives the admin a signal to investigate.
      skippedOther += 1;
    }
  }
  return { posted, skippedLocked, skippedOther };
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
