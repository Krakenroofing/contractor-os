// Small lookup helpers for displaying user names alongside audit fields
// (e.g., "submitted by Sam Carter on 2026-05-16"). DB-only — demo mode
// returns an empty map and the UI falls back to "—".

import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { users, memberships, employees, type User } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import type { Role } from '@/lib/permissions';

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

export type CompanyUserWithLink = {
  id: string;
  email: string;
  name: string;
  role: Role;
  employeeId: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
};

/**
 * Every active member of a company plus their current employee link.
 * Used by the admin link manager on /invite — one row per user, the
 * dropdown lets owner reassign or clear the employeeId.
 */
export async function listCompanyUsersWithLinks(
  companyId: string,
): Promise<CompanyUserWithLink[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      employeeId: users.employeeId,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(employees, eq(employees.id, users.employeeId))
    .where(
      and(
        eq(memberships.companyId, companyId),
        eq(memberships.status, 'active'),
      ),
    )
    .orderBy(asc(users.name));
  return rows.map((r) => ({
    ...r,
    role: r.role as Role,
  }));
}

/**
 * Set or clear a user's employee link. Validates that, when setting, the
 * target employee belongs to `companyId` so an admin can't accidentally
 * link a TRB user to a Kraken employee record.
 *
 * The DB partial-unique index `users_employee_id_uniq` enforces 1:1 —
 * trying to link an employee that's already linked to a different user
 * throws a unique-violation. Callers should map that to a friendly
 * "employee already linked to another user" message.
 */
export async function setUserEmployeeLink(
  userId: string,
  employeeId: string | null,
  companyId: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  if (employeeId !== null) {
    const owned = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(eq(employees.id, employeeId), eq(employees.companyId, companyId)),
      )
      .limit(1);
    if (owned.length === 0) {
      throw new Error('Employee does not belong to the active company.');
    }
  }
  await db
    .update(users)
    .set({ employeeId, updatedAt: new Date() })
    .where(eq(users.id, userId));
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
