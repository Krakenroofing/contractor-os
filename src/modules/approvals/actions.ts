'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { getUserNamesByIds } from '@/lib/data/users';
import {
  listControlExceptions,
  markControlExceptionReviewed,
} from '@/lib/data/approvals';

/** The other owner signs off a self-approval. You can't review your own. */
export async function reviewControlExceptionAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (role !== 'owner') return { ok: false, error: 'Only owners review exceptions.' };
  if (!z.string().uuid().safeParse(input.id).success) {
    return { ok: false, error: 'Invalid id.' };
  }
  const companyId = await getActiveCompanyId();
  const row = (await listControlExceptions(companyId)).find((e) => e.id === input.id);
  if (!row) return { ok: false, error: 'Not found.' };
  if (row.userId && row.userId === user.id) {
    return {
      ok: false,
      error: 'This is your own approval — the other owner reviews it.',
    };
  }
  const known = await getUserNamesByIds([user.id]);
  await markControlExceptionReviewed(
    companyId,
    input.id,
    known.has(user.id) ? user.id : null,
  );
  revalidatePath('/reports/control-exceptions');
  return { ok: true };
}
