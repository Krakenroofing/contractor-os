'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { users } from '@/db/schema';
import { isAuthEnabled } from '@/lib/auth';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';
import {
  getInvitationByToken,
  markInvitationAccepted,
} from '@/lib/data/invitations';
import { upsertMembership } from '@/lib/data/memberships';
import { isExpired } from '@/modules/invitations/lib/tokens';
import type { Role } from '@/lib/permissions';

export type AcceptInviteState = {
  ok?: boolean;
  email?: string;
  formError?: string;
  errors?: Record<string, string[]>;
};

const schema = z.object({
  token: z.string().min(1, 'Missing token'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200),
  name: z.string().max(200).optional().or(z.literal('')),
});

export async function acceptInviteAction(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  if (!isAuthEnabled()) {
    return {
      formError:
        'Invitations require Supabase Auth. The site is in demo mode.',
    };
  }
  if (!isDatabaseConfigured()) {
    return {
      formError:
        'Invitations require a configured database. Set DATABASE_URL.',
    };
  }

  const parsed = schema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    name: formData.get('name') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const { token, password, name } = parsed.data;

  // 1. Validate the token
  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    return { formError: 'Invitation not found.' };
  }
  if (invitation.acceptedAt) {
    return { formError: 'This invitation has already been accepted.' };
  }
  if (invitation.revokedAt) {
    return { formError: 'This invitation has been revoked.' };
  }
  if (isExpired(invitation.expiresAt)) {
    return { formError: 'This invitation has expired. Ask for a fresh one.' };
  }

  // 2. Provision the Supabase auth user via service role
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return {
      formError:
        'Server is missing SUPABASE_SERVICE_ROLE_KEY — cannot create auth user.',
    };
  }
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: name ? { name } : undefined,
    });
  if (createErr || !created?.user) {
    // The most common case: an auth.users row already exists for this email.
    // We surface that as a friendly message so the user signs in instead.
    const message = createErr?.message ?? 'Could not create user';
    return {
      formError: `${message}. If you already have an account, sign in at /login and ask the inviter to revoke + reissue.`,
    };
  }
  const newUserId = created.user.id;

  // 3. Mirror the auth user into public.users so memberships can FK to it.
  // If the invitation specified an employee_id (Phase M1 field-app link),
  // populate users.employee_id in the same insert so the field app can
  // identify which crew member just signed in on their first request.
  const db = getDb()!;
  await db
    .insert(users)
    .values({
      id: newUserId,
      email: invitation.email,
      name: name?.trim() || invitation.email,
      employeeId: invitation.employeeId ?? null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: invitation.email,
        name: name?.trim() || invitation.email,
        ...(invitation.employeeId
          ? { employeeId: invitation.employeeId }
          : {}),
      },
    });

  // 4. Create the membership row with the role from the invitation
  await upsertMembership({
    userId: newUserId,
    companyId: invitation.companyId,
    role: invitation.role as Role,
  });

  // 5. Mark the invitation accepted
  await markInvitationAccepted(invitation.id, newUserId);

  // Bonus housekeeping: revoke any other un-accepted invites for the same
  // email/company so the user can't later "double-accept" stale links.
  const dbForCleanup = db;
  await dbForCleanup.execute(
    // Inline SQL is fine here — the values are sourced from server-side state,
    // not user input.
    sqlRevokeStaleInvites(invitation.email, invitation.companyId, invitation.id),
  );

  return { ok: true, email: invitation.email };
}

// ---- helpers ----

import { sql } from 'drizzle-orm';

function sqlRevokeStaleInvites(email: string, companyId: string, exceptId: string) {
  return sql`
    UPDATE public.invitations
    SET revoked_at = now(), updated_at = now()
    WHERE email = ${email}
      AND company_id = ${companyId}
      AND id <> ${exceptId}
      AND accepted_at IS NULL
      AND revoked_at IS NULL
  `;
}
