'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { setUserEmployeeLink } from '@/lib/data/users';

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
