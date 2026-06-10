'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser, isAuthEnabled } from '@/lib/auth';
import { canCreate, ROLES } from '@/lib/permissions';
import {
  createInvitation,
  getInvitation,
  refreshInvitationToken,
  revokeInvitation as dataRevoke,
} from '@/lib/data/invitations';
import {
  generateInviteToken,
  inviteAcceptUrl,
  INVITE_TTL_MS,
} from './lib/tokens';

export type CreateInvitationState = {
  ok?: boolean;
  acceptUrl?: string;
  errors?: Record<string, string[]>;
  formError?: string;
};

const createSchema = z.object({
  email: z.string().email('Invalid email').max(200),
  role: z.enum(ROLES),
  // Empty string when not provided (HTML select default). Coerce to null
  // so the data layer treats it as "no link". Validated as a UUID when
  // present.
  employeeId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export async function createInvitationAction(
  _prev: CreateInvitationState,
  formData: FormData,
): Promise<CreateInvitationState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'invitations')) {
    return { formError: 'Only owners can invite users.' };
  }
  if (!isAuthEnabled()) {
    return {
      formError:
        'Invitations require Supabase Auth. Configure NEXT_PUBLIC_SUPABASE_URL + ANON_KEY.',
    };
  }

  const parsed = createSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'view_only',
    employeeId: formData.get('employeeId') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const inviter = await getCurrentUser();

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  try {
    await createInvitation({
      companyId,
      email: parsed.data.email,
      role: parsed.data.role,
      token,
      expiresAt,
      invitedByUserId: inviter?.id ?? null,
      employeeId: parsed.data.employeeId ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create invitation: ${message}` };
  }

  const acceptUrl = await inviteAcceptUrl(token);

  revalidatePath('/invite');
  return { ok: true, acceptUrl };
}

export type RevokeInvitationState = {
  ok?: boolean;
  formError?: string;
};

export async function revokeInvitationAction(
  _prev: RevokeInvitationState,
  formData: FormData,
): Promise<RevokeInvitationState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'invitations')) {
    return { formError: 'Only owners can revoke invitations.' };
  }

  const id = formData.get('invitationId');
  if (typeof id !== 'string' || id === '') {
    return { formError: 'Missing invitation id.' };
  }
  const companyId = await getActiveCompanyId();
  await dataRevoke(companyId, id);
  revalidatePath('/invite');
  return { ok: true };
}

export type ResendInvitationState = {
  ok?: boolean;
  acceptUrl?: string;
  formError?: string;
};

// Re-arm a pending (or expired) invite with a fresh token + 7-day expiry and
// return a new accept link to share. Owner-only.
export async function resendInvitationAction(
  _prev: ResendInvitationState,
  formData: FormData,
): Promise<ResendInvitationState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'invitations')) {
    return { formError: 'Only owners can resend invitations.' };
  }
  const id = formData.get('invitationId');
  if (typeof id !== 'string' || id === '') {
    return { formError: 'Missing invitation id.' };
  }
  const companyId = await getActiveCompanyId();
  const inv = await getInvitation(companyId, id);
  if (!inv) return { formError: 'Invitation not found.' };
  if (inv.acceptedAt) {
    return { formError: 'That invite was already accepted.' };
  }

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const updated = await refreshInvitationToken(companyId, id, token, expiresAt);
  if (!updated) return { formError: 'Could not refresh the invitation.' };

  const acceptUrl = await inviteAcceptUrl(token);
  revalidatePath('/invite');
  return { ok: true, acceptUrl };
}
