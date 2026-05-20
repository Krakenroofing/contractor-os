'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, ROLE_LABELS } from '@/lib/permissions';
import { setProjectVerified } from '@/lib/data/projects';
import { appendActivity } from '@/lib/mock-store';

export type VerifyState = {
  ok?: boolean;
  formError?: string;
  errors?: Record<string, string[]>;
};

const verifySchema = z.object({
  projectId: z.string().uuid('Project id required'),
  note: z.string().max(2000).optional().or(z.literal('')),
});

export async function markProjectVerifiedAction(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'reconciliation')) {
    return { formError: 'Not allowed to mark projects verified.' };
  }

  const parsed = verifySchema.safeParse({
    projectId: formData.get('projectId'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const { projectId, note } = parsed.data;
  const companyId = await getActiveCompanyId();

  const updated = await setProjectVerified(companyId, projectId, {
    verifiedAt: new Date(),
    verifiedRole: ROLE_LABELS[role],
    verifiedNote: note && note.trim() !== '' ? note.trim() : null,
  });
  if (!updated) {
    return { formError: 'Project not found.' };
  }

  appendActivity(companyId, {
    entityType: 'project' as never,
    entityId: projectId,
    kind: 'reconciliation_verified',
    summary: `Project ${updated.name} marked reconciled${note ? ` — ${note.trim()}` : ''}`,
    actorRole: ROLE_LABELS[role],
  });

  revalidatePath('/reconciliation');
  revalidatePath(`/reconciliation/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function unmarkProjectVerifiedAction(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'reconciliation')) {
    return { formError: 'Not allowed to change verification.' };
  }

  const projectId = formData.get('projectId');
  if (typeof projectId !== 'string' || projectId === '') {
    return { formError: 'Project id required.' };
  }
  const companyId = await getActiveCompanyId();

  const updated = await setProjectVerified(companyId, projectId, {
    verifiedAt: null,
    verifiedRole: null,
    verifiedNote: null,
  });
  if (!updated) {
    return { formError: 'Project not found.' };
  }

  appendActivity(companyId, {
    entityType: 'project' as never,
    entityId: projectId,
    kind: 'reconciliation_unverified',
    summary: `Project ${updated.name}: reconciliation flag cleared`,
    actorRole: ROLE_LABELS[role],
  });

  revalidatePath('/reconciliation');
  revalidatePath(`/reconciliation/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
