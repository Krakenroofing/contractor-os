// Owner-only sign-in activity tracking.
//
// Lifecycle: recordLogin() opens a session row at sign-in. touchSession()
// runs from the app/field layouts on every server-rendered navigation and
// bumps last_seen_at (throttled — see HEARTBEAT_MIN_MS, so it's at most
// one tiny conditional UPDATE per couple of minutes per user). endSession()
// stamps ended_at on explicit sign-out. If a user goes quiet for
// SESSION_GAP_MS and comes back, the stale row is closed at its last
// heartbeat and a fresh session opens — so each workday reads as its own
// row even when nobody ever presses Sign Out.
//
// One open session per user: a second device folds into the same row.
// Every call is best-effort — activity tracking must never break a page.

import 'server-only';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { userLoginSessions, users } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

/** Don't rewrite last_seen_at more often than this. */
const HEARTBEAT_MIN_MS = 2 * 60 * 1000;
/** Inactivity gap that ends a session and starts a new one. */
const SESSION_GAP_MS = 6 * 60 * 60 * 1000;

export async function recordLogin(userId: string, userAgent?: string | null): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  // Close any dangling open session first (previous day never signed out).
  await db
    .update(userLoginSessions)
    .set({ endedAt: sql`last_seen_at` })
    .where(and(eq(userLoginSessions.userId, userId), isNull(userLoginSessions.endedAt)));
  await db.insert(userLoginSessions).values({
    userId,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
}

export async function touchSession(userId: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  const now = new Date();
  const open = await db
    .select({
      id: userLoginSessions.id,
      lastSeenAt: userLoginSessions.lastSeenAt,
    })
    .from(userLoginSessions)
    .where(and(eq(userLoginSessions.userId, userId), isNull(userLoginSessions.endedAt)))
    .orderBy(desc(userLoginSessions.startedAt))
    .limit(1);

  const row = open[0];
  if (!row) {
    // Signed in before this feature shipped (or a remember-me session that
    // never re-ran the login action): open a session at first sighting.
    await db.insert(userLoginSessions).values({ userId });
    return;
  }
  const idleMs = now.getTime() - row.lastSeenAt.getTime();
  if (idleMs < HEARTBEAT_MIN_MS) return; // throttle
  if (idleMs > SESSION_GAP_MS) {
    // Long gap: close the stale row at its last heartbeat, start fresh.
    await db
      .update(userLoginSessions)
      .set({ endedAt: row.lastSeenAt })
      .where(eq(userLoginSessions.id, row.id));
    await db.insert(userLoginSessions).values({ userId });
    return;
  }
  await db
    .update(userLoginSessions)
    .set({ lastSeenAt: now })
    .where(eq(userLoginSessions.id, row.id));
}

export async function endSession(userId: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .update(userLoginSessions)
    .set({ endedAt: sql`last_seen_at` })
    .where(and(eq(userLoginSessions.userId, userId), isNull(userLoginSessions.endedAt)));
}

export type LoginSessionRow = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  startedAt: Date;
  lastSeenAt: Date;
  endedAt: Date | null;
  userAgent: string | null;
};

/** Sessions started in the last `days` days, newest first. */
export async function listLoginSessions(days: number): Promise<LoginSessionRow[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: userLoginSessions.id,
      userId: userLoginSessions.userId,
      userName: users.name,
      userEmail: users.email,
      startedAt: userLoginSessions.startedAt,
      lastSeenAt: userLoginSessions.lastSeenAt,
      endedAt: userLoginSessions.endedAt,
      userAgent: userLoginSessions.userAgent,
    })
    .from(userLoginSessions)
    .innerJoin(users, eq(users.id, userLoginSessions.userId))
    .where(gte(userLoginSessions.startedAt, since))
    .orderBy(desc(userLoginSessions.startedAt));
  return rows;
}
