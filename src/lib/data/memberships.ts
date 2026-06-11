// Async data accessor for memberships (user ↔ company link with a role).
//
// In DB mode reads from the `memberships` table. In demo mode there are no
// real users — we synthesize a single membership per company that grants
// the demo user "owner" so the UI can keep its existing role-switcher.

import 'server-only';
import { cache } from 'react';
import { and, asc, eq } from 'drizzle-orm';
import { memberships, users, type Membership } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import type { Role } from '@/lib/permissions';

// Both reads are wrapped in React.cache so layout + active-company +
// active-role + diagnostics + page don't each issue a duplicate query
// during the same render. (Drizzle is fast, but the layout-then-page
// pattern can produce ~6 redundant queries per nav, which adds up.)
export const listMembershipsForUser = cache(async function listMembershipsForUser(
  userId: string,
): Promise<Membership[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
  }
  return [];
});

export const getMembership = cache(async function getMembership(
  userId: string,
  companyId: string,
): Promise<Membership | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.companyId, companyId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return undefined;
});

/** Active members of a company (user id + display name + role). Used by
 *  flows that need to pick a person — e.g. the receipts reimbursement
 *  payer dropdown. Demo mode returns []. */
export const listMembersForCompany = cache(async function listMembersForCompany(
  companyId: string,
): Promise<Array<{ userId: string; name: string; role: Role }>> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(eq(memberships.companyId, companyId), eq(memberships.status, 'active')),
    )
    .orderBy(asc(users.name));
  return rows;
});

/** A user's membership in a company regardless of status (active, suspended,
 *  invited). Used by owner admin actions that need the current role/status to
 *  apply guards (e.g. "don't suspend the last owner"). */
export async function getMembershipAnyStatus(
  companyId: string,
  userId: string,
): Promise<Membership | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Count active owners of a company — guards last-owner removal/demotion. */
export async function countActiveOwners(companyId: string): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.companyId, companyId),
        eq(memberships.role, 'owner'),
        eq(memberships.status, 'active'),
      ),
    );
  return rows.length;
}

/** Flip a member's status (active ⇄ suspended). Suspended users have no
 *  active membership, so every access check (which filters status='active')
 *  immediately denies them. Returns false if no row matched. */
export async function setMembershipStatus(
  companyId: string,
  userId: string,
  status: 'active' | 'suspended',
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const db = getDb()!;
  const res = await db
    .update(memberships)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.companyId, companyId),
        eq(memberships.userId, userId),
      ),
    )
    .returning({ id: memberships.id });
  return res.length > 0;
}

/** Change a member's role. Returns false if no row matched. */
export async function updateMembershipRole(
  companyId: string,
  userId: string,
  role: Role,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const db = getDb()!;
  const res = await db
    .update(memberships)
    .set({ role, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.companyId, companyId),
        eq(memberships.userId, userId),
      ),
    )
    .returning({ id: memberships.id });
  return res.length > 0;
}

/** Remove a member from a company outright (not just suspend). Used by the
 *  "delete login" admin flow. Returns false if no row matched. */
export async function deleteMembership(
  companyId: string,
  userId: string,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const db = getDb()!;
  const res = await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.companyId, companyId),
        eq(memberships.userId, userId),
      ),
    )
    .returning({ id: memberships.id });
  return res.length > 0;
}

/** Count every membership this user holds, across all companies and
 *  statuses. The delete-login flow uses this to decide whether removing
 *  them from THIS company should also tear down the shared login: only
 *  when this is their last membership (single-tenant in practice, but we
 *  never want to nuke an auth account a TRB user still relies on). */
export async function countMembershipsForUser(userId: string): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  return rows.length;
}

/**
 * Upsert a membership row. Used during onboarding to ensure a freshly-signed-up
 * user has at least one membership.
 */
export async function upsertMembership(input: {
  userId: string;
  companyId: string;
  role: Role;
}): Promise<Membership | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const existing = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, input.userId),
        eq(memberships.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0];
  const inserted = await db
    .insert(memberships)
    .values({
      userId: input.userId,
      companyId: input.companyId,
      role: input.role,
      status: 'active',
    })
    .returning();
  return inserted[0];
}
