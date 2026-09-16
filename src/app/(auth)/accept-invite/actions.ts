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

  // 2. Existing account? An invitee who already registered (e.g. invited
  // to the other company first, or re-invited after a role change) accepts
  // with their EXISTING password — we verify it and attach the membership
  // to their account instead of trying to create a duplicate.
  const db0 = getDb()!;
  const existingUsers = await db0
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${invitation.email})`)
    .limit(1);

  let newUserId: string;
  if (existingUsers.length > 0) {
    const verified = await verifyExistingPassword(invitation.email, password);
    if (verified === null) {
      return {
        formError:
          'Auth is not configured on this deployment — cannot verify the password.',
      };
    }
    if (!verified) {
      return {
        formError:
          'This email already has a KrakenOps Pro account — enter that account\'s password to accept the invitation. Forgot it? Reset it at /forgot-password, then come back to this link.',
      };
    }
    newUserId = existingUsers[0].id;
  } else {
    // Brand-new invitee: provision the Supabase auth user via service role.
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
      const message = createErr?.message ?? 'Could not create user';
      return {
        formError: `${message}. If you already have an account, reload this page and accept with your existing password.`,
      };
    }
    newUserId = created.user.id;
  }

  // 3. Mirror the auth user into public.users so memberships can FK to it.
  // If the invitation specified an employee_id (Phase M1 field-app link),
  // populate users.employee_id in the same insert so the field app can
  // identify which crew member just signed in on their first request.
  const db = getDb()!;
  try {
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
          // Never blank out an existing user's display name — the
          // existing-account accept form doesn't ask for one.
          ...(name?.trim() ? { name: name.trim() } : {}),
          ...(invitation.employeeId
            ? { employeeId: invitation.employeeId }
            : {}),
        },
      });
  } catch {
    // Most likely: the invitation's employee is already linked to another
    // login (users.employee_id is 1:1).
    return {
      formError:
        'This invitation is linked to a crew member who already has a login. Ask the office to revoke it and send a fresh invite.',
    };
  }

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
import { createClient } from '@supabase/supabase-js';

/** Check the password against the EXISTING auth account for this email.
 *  One-shot anon client, no session persisted — pure verification.
 *  Returns null when auth env isn't configured. */
async function verifyExistingPassword(
  email: string,
  password: string,
): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

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
