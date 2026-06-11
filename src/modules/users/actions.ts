'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser, requireAuth } from '@/lib/auth';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';
import { canCreate, ROLES } from '@/lib/permissions';
import {
  getUserEmailById,
  setUserEmployeeLink,
  tombstoneUserRecord,
} from '@/lib/data/users';
import {
  countActiveOwners,
  countMembershipsForUser,
  deleteMembership,
  getMembershipAnyStatus,
  setMembershipStatus,
  updateMembershipRole,
} from '@/lib/data/memberships';

export type LinkUserState = {
  ok?: boolean;
  error?: string;
};

/**
 * Link or unlink a user → employee. Empty/missing 'employeeId' clears
 * the link. Gated on `invitations:create` — same admin permission used
 * for the invite flow itself.
 */
export async function linkUserToEmployeeAction(
  userId: string,
  _prev: LinkUserState,
  formData: FormData,
): Promise<LinkUserState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invitations')) {
    return { error: 'You do not have permission to manage user links.' };
  }
  const companyId = await getActiveCompanyId();

  const raw = (formData.get('employeeId') ?? '').toString().trim();
  const employeeId = raw === '' ? null : raw;

  try {
    await setUserEmployeeLink(userId, employeeId, companyId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update link';
    // Postgres unique-violation surfaces with code 23505 / message
    // containing the index name. Map to a clearer message.
    if (msg.includes('users_employee_id_uniq') || msg.includes('23505')) {
      return {
        error:
          'That employee is already linked to another user. Unlink them first, then try again.',
      };
    }
    return { error: msg };
  }

  revalidatePath('/invite');
  return { ok: true };
}

// ===========================================================================
// Owner access controls — revoke/restore + role change. All owner-gated
// (invitations:create) with last-owner and self-suspend guards.
// ===========================================================================

export type UserAdminState = { ok?: boolean; error?: string };

async function requireOwnerCompany(): Promise<string | null> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invitations')) return null;
  return getActiveCompanyId();
}

function userIdFrom(formData: FormData): string {
  const v = formData.get('userId');
  return typeof v === 'string' ? v : '';
}

// Suspend a member — instantly cuts access (every check filters
// status='active'). Guards: can't suspend yourself; can't remove the last
// active owner.
export async function suspendUserAction(
  _prev: UserAdminState,
  formData: FormData,
): Promise<UserAdminState> {
  const companyId = await requireOwnerCompany();
  if (!companyId) return { error: 'Only owners can manage users.' };
  const userId = userIdFrom(formData);
  if (!userId) return { error: 'Missing user.' };

  const me = await getCurrentUser();
  if (me?.id === userId) {
    return { error: "You can't suspend your own access." };
  }
  const target = await getMembershipAnyStatus(companyId, userId);
  if (!target) return { error: 'User is not a member of this company.' };
  if (target.role === 'owner' && (await countActiveOwners(companyId)) <= 1) {
    return { error: 'There must be at least one active owner.' };
  }

  const ok = await setMembershipStatus(companyId, userId, 'suspended');
  if (!ok) return { error: 'Could not suspend this user.' };
  revalidatePath('/invite');
  return { ok: true };
}

// Restore a suspended member.
export async function restoreUserAction(
  _prev: UserAdminState,
  formData: FormData,
): Promise<UserAdminState> {
  const companyId = await requireOwnerCompany();
  if (!companyId) return { error: 'Only owners can manage users.' };
  const userId = userIdFrom(formData);
  if (!userId) return { error: 'Missing user.' };

  const ok = await setMembershipStatus(companyId, userId, 'active');
  if (!ok) return { error: 'Could not restore this user.' };
  revalidatePath('/invite');
  return { ok: true };
}

/**
 * Permanently delete a user's login. Owner-only, and only allowed once the
 * member is already suspended — suspend is the reversible "cut access now"
 * step; this is the irreversible cleanup. Guards: can't delete your own
 * login; must be suspended first. (An owner can only be suspended when
 * another active owner exists, so a deletable user is never the last owner
 * — no separate owner guard needed.)
 *
 * What it does, in order:
 *  1. If this is the user's ONLY membership (the common single-company
 *     case), delete their Supabase Auth account — that's the actual login.
 *     If they belong to another company too, we skip the auth delete and
 *     just remove them from THIS company, so we never lock them out of a
 *     company this owner doesn't control.
 *  2. Remove the membership (drops them off the Users tab).
 *  3. Tombstone the mirror row (clears the employee link, frees the email).
 */
export async function deleteUserLoginAction(
  _prev: UserAdminState,
  formData: FormData,
): Promise<UserAdminState> {
  const companyId = await requireOwnerCompany();
  if (!companyId) return { error: 'Only owners can manage users.' };
  const userId = userIdFrom(formData);
  if (!userId) return { error: 'Missing user.' };

  const me = await getCurrentUser();
  if (me?.id === userId) {
    return { error: "You can't delete your own login." };
  }
  const target = await getMembershipAnyStatus(companyId, userId);
  if (!target) return { error: 'User is not a member of this company.' };
  if (target.status !== 'suspended') {
    return {
      error: 'Suspend this user first, then you can delete their login.',
    };
  }

  const isOnlyMembership = (await countMembershipsForUser(userId)) <= 1;

  // Tear down the auth login only when this is their last company. If the
  // admin client is unavailable we can't safely delete the login, so bail
  // before touching any DB rows.
  if (isOnlyMembership) {
    const admin = getSupabaseAdminClient();
    if (!admin) {
      return { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    // A "not found" means the auth row is already gone — fine, keep going
    // and finish the DB cleanup. Any other error aborts before DB changes.
    if (error && !/not\s*found/i.test(error.message)) {
      return { error: `Could not delete the login: ${error.message}` };
    }
  }

  await deleteMembership(companyId, userId);
  if (isOnlyMembership) {
    await tombstoneUserRecord(userId);
  } else {
    // Still in another company — just unlink them from this one's employee
    // record; leave the shared login and mirror row intact.
    await setUserEmployeeLink(userId, null, companyId);
  }

  revalidatePath('/invite');
  return { ok: true };
}

const roleSchema = z.enum(ROLES);

// Change a member's role. Guard: don't demote the last active owner.
export async function changeUserRoleAction(
  _prev: UserAdminState,
  formData: FormData,
): Promise<UserAdminState> {
  const companyId = await requireOwnerCompany();
  if (!companyId) return { error: 'Only owners can manage users.' };
  const userId = userIdFrom(formData);
  if (!userId) return { error: 'Missing user.' };

  const parsedRole = roleSchema.safeParse(formData.get('role'));
  if (!parsedRole.success) return { error: 'Invalid role.' };
  const newRole = parsedRole.data;

  const target = await getMembershipAnyStatus(companyId, userId);
  if (!target) return { error: 'User is not a member of this company.' };
  if (target.role === newRole) return { ok: true };
  if (
    target.role === 'owner' &&
    newRole !== 'owner' &&
    target.status === 'active' &&
    (await countActiveOwners(companyId)) <= 1
  ) {
    return { error: 'There must be at least one active owner.' };
  }

  const ok = await updateMembershipRole(companyId, userId, newRole);
  if (!ok) return { error: 'Could not change role.' };
  revalidatePath('/invite');
  return { ok: true };
}

export type ResetLinkState = { ok?: boolean; link?: string; error?: string };

// Owner-generated password-reset link. Uses the Supabase admin API to mint a
// recovery link the owner can hand to a stuck user directly (text/WhatsApp) —
// works even when email delivery is misconfigured. Email is looked up by id,
// never trusted from the form.
export async function sendPasswordResetAction(
  _prev: ResetLinkState,
  formData: FormData,
): Promise<ResetLinkState> {
  const companyId = await requireOwnerCompany();
  if (!companyId) return { error: 'Only owners can manage users.' };
  const userId = userIdFrom(formData);
  if (!userId) return { error: 'Missing user.' };

  const target = await getMembershipAnyStatus(companyId, userId);
  if (!target) return { error: 'User is not a member of this company.' };
  const email = await getUserEmailById(userId);
  if (!email) return { error: 'No email on file for this user.' };

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' };
  }

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    (host ? `${proto}://${host}` : '');

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${origin}/reset-password` },
  });
  const link = data?.properties?.action_link;
  if (error || !link) {
    return { error: error?.message ?? 'Could not generate a reset link.' };
  }
  return { ok: true, link };
}
