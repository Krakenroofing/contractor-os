'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser, requireAuth } from '@/lib/auth';
import { canCreate, ROLES } from '@/lib/permissions';
import { setUserEmployeeLink } from '@/lib/data/users';
import {
  countActiveOwners,
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
