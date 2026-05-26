// Async data accessor for invitations (DB only — there's no in-memory mock
// for invites; demo mode doesn't have real users to invite).

import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { invitations, type Invitation } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import type { Role } from '@/lib/permissions';

export type CreateInvitationInput = {
  companyId: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: Date;
  invitedByUserId: string | null;
  // Optional: link this invite to an existing employee record. When the
  // recipient accepts, users.employee_id is populated from this field so
  // the field app can identify "which crew member just signed in".
  employeeId?: string | null;
};

/**
 * List active (not accepted, not revoked) invitations for a company,
 * including expired ones so the admin can see why a user can't accept.
 */
export async function listInvitationsForCompany(
  companyId: string,
): Promise<Invitation[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(invitations)
    .where(eq(invitations.companyId, companyId))
    .orderBy(desc(invitations.createdAt));
}

export async function getInvitationByToken(
  token: string,
): Promise<Invitation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  return rows[0];
}

export async function getInvitation(
  companyId: string,
  id: string,
): Promise<Invitation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.companyId, companyId)))
    .limit(1);
  return rows[0];
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<Invitation> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Invitations require a configured database. Set DATABASE_URL.',
    );
  }
  const db = getDb()!;
  const rows = await db
    .insert(invitations)
    .values({
      companyId: input.companyId,
      email: input.email.toLowerCase().trim(),
      role: input.role,
      token: input.token,
      expiresAt: input.expiresAt,
      invitedByUserId: input.invitedByUserId,
      employeeId: input.employeeId ?? null,
    })
    .returning();
  return rows[0];
}

export async function revokeInvitation(
  companyId: string,
  id: string,
): Promise<Invitation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .update(invitations)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(invitations.id, id),
        eq(invitations.companyId, companyId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function markInvitationAccepted(
  invitationId: string,
  acceptedByUserId: string,
): Promise<Invitation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const now = new Date();
  const rows = await db
    .update(invitations)
    .set({
      acceptedAt: now,
      acceptedByUserId,
      updatedAt: now,
    })
    .where(eq(invitations.id, invitationId))
    .returning();
  return rows[0];
}
