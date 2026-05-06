// Async data accessor for memberships (user ↔ company link with a role).
//
// In DB mode reads from the `memberships` table. In demo mode there are no
// real users — we synthesize a single membership per company that grants
// the demo user "owner" so the UI can keep its existing role-switcher.

import 'server-only';
import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import { memberships, type Membership } from '@/db/schema';
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
