// Small lookup helpers for displaying user names alongside audit fields
// (e.g., "submitted by Sam Carter on 2026-05-16"). DB-only — demo mode
// returns an empty map and the UI falls back to "—".

import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { users, memberships, type User } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

/** Batch fetch users by id. Returns a Map<id, name> for easy lookup. Missing
 *  ids are simply absent from the map. */
export async function getUserNamesByIds(
  ids: string[],
): Promise<Map<string, string>> {
  if (!isDatabaseConfigured() || ids.length === 0) return new Map();
  const db = getDb()!;
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Return users belonging to a company who already have an employee link.
 *
 * Used by the invite form (Phase M1 field app) to mark employees as
 * "already linked" so the admin doesn't accidentally invite a second
 * login for the same crew member. The set is typically small — one row
 * per field worker with app access.
 */
export async function listUsersWithEmployeeLink(
  companyId: string,
): Promise<Pick<User, 'id' | 'email' | 'employeeId'>[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const memberRows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.companyId, companyId));
  const userIds = memberRows.map((r) => r.userId);
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      employeeId: users.employeeId,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  return rows.filter((r) => r.employeeId != null);
}
