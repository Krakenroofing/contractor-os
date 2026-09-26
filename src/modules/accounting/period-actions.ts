'use server';

// Close / reopen posting periods. Closing: owner or accounting (Olga runs
// the month-end). Reopening: owner only, with a required reason — both
// land in the period log.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { getUserNamesByIds } from '@/lib/data/users';
import {
  closePeriodsThrough,
  monthLabel,
  reopenPeriod,
} from '@/lib/data/accounting-periods';

export type PeriodActionState = { ok?: boolean; error?: string; message?: string };

const monthSchema = z.string().regex(/^\d{4}-\d{2}-01$/, 'Pick a month.');

async function actor() {
  const user = await requireAuth();
  const known = await getUserNamesByIds([user.id]);
  return {
    id: known.has(user.id) ? user.id : null,
    name: user.name || user.email || null,
  };
}

export async function closePeriodsThroughAction(
  throughMonth: string,
): Promise<PeriodActionState> {
  const role = await getActiveRole();
  if (role !== 'owner' && role !== 'accounting') {
    return { error: 'Only the owner or accounting can close periods.' };
  }
  const parsed = monthSchema.safeParse(throughMonth);
  if (!parsed.success) return { error: 'Pick a month to close through.' };
  const companyId = await getActiveCompanyId();
  try {
    const res = await closePeriodsThrough(companyId, parsed.data, await actor());
    revalidatePath('/settings/accounting/periods');
    return {
      ok: true,
      message:
        res.closed.length === 0
          ? `Everything through ${monthLabel(parsed.data)} was already closed.`
          : `Closed ${res.closed.length} month${res.closed.length === 1 ? '' : 's'} through ${monthLabel(parsed.data)}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not close.' };
  }
}

export async function reopenPeriodAction(
  month: string,
  reason: string,
): Promise<PeriodActionState> {
  const role = await getActiveRole();
  if (role !== 'owner') {
    return { error: 'Only the owner can reopen a closed period.' };
  }
  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) return { error: 'Pick a month to reopen.' };
  const why = (reason ?? '').trim();
  if (why.length < 3) {
    return { error: 'Give a reason for reopening — it goes in the audit log.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    await reopenPeriod(companyId, parsed.data, await actor(), why.slice(0, 500));
    revalidatePath('/settings/accounting/periods');
    return { ok: true, message: `${monthLabel(parsed.data)} reopened.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reopen.' };
  }
}
