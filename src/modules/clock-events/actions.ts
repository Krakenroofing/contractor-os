'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  deleteClockEvent,
  getClockEvent,
  listPostableSessions,
  markPunchesReviewed,
  postSessionsToTimeEntries,
  PunchAlreadyPostedError,
  unmarkPunchesReviewed,
  updateClockEvent,
} from '@/lib/data/clock-events';
import { updateCompany } from '@/lib/data/companies';
import { parseDateTimeLocalInTZ } from '@/lib/tz';

export type EditPunchState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

const editSchema = z.object({
  // datetime-local emits 'YYYY-MM-DDTHH:mm' (no seconds). Browser-local
  // tz is implicit — we re-anchor to UTC at parse time.
  occurredAt: z
    .string()
    .min(1, 'Time is required')
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      'Invalid date/time',
    ),
  projectId: z.string().optional(),
  costCodeId: z.string().optional(),
  notes: z.string().optional(),
});

function emptyToNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function editPunchAction(
  punchId: string,
  _prev: EditPunchState,
  formData: FormData,
): Promise<EditPunchState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'clock_events')) {
    return { formError: 'You do not have permission to edit punches.' };
  }
  const companyId = await getActiveCompanyId();
  const existing = await getClockEvent(companyId, punchId);
  if (!existing) return { formError: 'Punch not found.' };

  const parsed = editSchema.safeParse({
    occurredAt: formData.get('occurredAt')?.toString() ?? '',
    projectId: formData.get('projectId')?.toString() ?? '',
    costCodeId: formData.get('costCodeId')?.toString() ?? '',
    notes: formData.get('notes')?.toString() ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  // The browser's datetime-local input emits wall-clock without an
  // offset. We treat it as APP_TZ (Nassau) — the office user edits the
  // punch as the worker would have seen it on the job site, regardless
  // of where the server runs.
  let occurredAt: Date;
  try {
    occurredAt = parseDateTimeLocalInTZ(parsed.data.occurredAt);
  } catch {
    return { errors: { occurredAt: ['Invalid date/time'] } };
  }

  try {
    await updateClockEvent(companyId, punchId, {
      occurredAt,
      projectId: emptyToNull(parsed.data.projectId),
      costCodeId: emptyToNull(parsed.data.costCodeId),
      notes: emptyToNull(parsed.data.notes),
    });
  } catch (err) {
    if (err instanceof PunchAlreadyPostedError) {
      return { formError: err.message };
    }
    throw err;
  }

  revalidatePath('/clock');
  redirect('/clock' as never);
}

export async function deletePunchAction(punchId: string): Promise<void> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'clock_events')) {
    throw new Error('You do not have permission to delete punches.');
  }
  const companyId = await getActiveCompanyId();
  try {
    await deleteClockEvent(companyId, punchId);
  } catch (err) {
    if (err instanceof PunchAlreadyPostedError) throw err;
    throw err;
  }
  revalidatePath('/clock');
}

/**
 * Toggle the company-level auto-post flag (Phase M6.3). When ON, the
 * punch-out action immediately marks the session reviewed (by the
 * worker themselves) and posts it to time_entries — no admin
 * ceremony. Gated on settings:create — owner only.
 *
 * The desired state is passed as a string in formData ('on' / 'off')
 * so a plain server-rendered form can flip it without client JS.
 */
export async function setAutoPostClockSessionsAction(
  formData: FormData,
): Promise<void> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    throw new Error('Only owners can change company settings.');
  }
  const companyId = await getActiveCompanyId();
  const desired = (formData.get('value') ?? '').toString();
  await updateCompany(companyId, {
    autoPostClockSessions: desired === 'on',
  });
  revalidatePath('/clock');
}

/**
 * Post every reviewed-and-unposted paired session to time_entries.
 * Result counts (posted / skippedLocked / skippedOther) are returned
 * via redirect query params so the /clock page can surface a banner.
 * Gated on payroll:create — PMs can review but can't post.
 */
export async function postReviewedSessionsAction(): Promise<void> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    throw new Error('You do not have permission to post to payroll.');
  }
  const companyId = await getActiveCompanyId();
  const sessions = await listPostableSessions(companyId);
  const result = await postSessionsToTimeEntries(companyId, sessions);
  revalidatePath('/clock');
  redirect(
    (`/clock?posted=${result.posted}&locked=${result.skippedLocked}&err=${result.skippedOther}`) as never,
  );
}

export async function markSessionReviewedAction(
  punchIds: string[],
): Promise<void> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'clock_events')) {
    throw new Error('You do not have permission to review punches.');
  }
  const companyId = await getActiveCompanyId();
  await markPunchesReviewed(companyId, punchIds, user.id);
  revalidatePath('/clock');
}

export async function unmarkSessionReviewedAction(
  punchIds: string[],
): Promise<void> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'clock_events')) {
    throw new Error('You do not have permission to un-review punches.');
  }
  const companyId = await getActiveCompanyId();
  await unmarkPunchesReviewed(companyId, punchIds);
  revalidatePath('/clock');
}
