'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createTimeEntry,
  deleteTimeEntry,
  getTimeEntry,
  updateTimeEntry,
} from '@/lib/data/time-entries';
import { getOrCreatePeriodForDate, getPayPeriod, updatePayPeriod } from '@/lib/data/pay-periods';
import { mondayOf } from './lib/periods';
import { timeEntryFormSchema } from './schema';

export type TimeEntryState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function readForm(formData: FormData) {
  return {
    employeeId: formData.get('employeeId') ?? '',
    workDate: formData.get('workDate') ?? '',
    hours: formData.get('hours') ?? '',
    projectId: formData.get('projectId') ?? '',
    costCodeId: formData.get('costCodeId') ?? '',
    notes: formData.get('notes') ?? '',
  };
}

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

async function assertPeriodEditable(
  companyId: string,
  payPeriodId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const period = await getPayPeriod(companyId, payPeriodId);
  if (!period) return { ok: false, reason: 'Pay period not found.' };
  if (period.status === 'locked') {
    return { ok: false, reason: 'This pay period is locked. Unlock it before editing entries.' };
  }
  return { ok: true };
}

export async function createTimeEntryAction(
  _prev: TimeEntryState,
  formData: FormData,
): Promise<TimeEntryState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to enter payroll time.' };
  }

  const parsed = timeEntryFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  // Resolve / create the weekly period that owns this date.
  const period = await getOrCreatePeriodForDate(companyId, data.workDate);
  if (period.status === 'locked') {
    return {
      formError:
        'The pay period for that date is locked. Pick a different date or unlock the period.',
    };
  }

  try {
    await createTimeEntry(companyId, {
      employeeId: data.employeeId,
      payPeriodId: period.id,
      workDate: data.workDate,
      hours: data.hours,
      projectId: data.projectId,
      costCodeId: data.costCodeId,
      notes: emptyToNull(data.notes ?? null),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save time entry: ${message}` };
  }

  revalidatePath('/payroll');
  redirect(`/payroll?week=${mondayOf(data.workDate)}`);
}

const idSchema = z.string().uuid('Missing or invalid id');

export async function updateTimeEntryAction(
  _prev: TimeEntryState,
  formData: FormData,
): Promise<TimeEntryState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to edit payroll time.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) return { formError: 'Missing time entry id.' };
  const id = idResult.data;

  const parsed = timeEntryFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  const existing = await getTimeEntry(companyId, id);
  if (!existing) {
    return { formError: 'Time entry not found.' };
  }

  // If the date moved into a different week, snap the entry into that
  // week's period. The old period stays — it might still contain other
  // entries — but the time entry itself migrates.
  const period = await getOrCreatePeriodForDate(companyId, data.workDate);
  if (period.status === 'locked') {
    return {
      formError:
        'The target pay period is locked. Pick a different date or unlock the period.',
    };
  }
  // Don't allow editing into / out of a locked period.
  const sourceCheck = await assertPeriodEditable(companyId, existing.payPeriodId);
  if (!sourceCheck.ok) {
    return { formError: sourceCheck.reason };
  }

  try {
    await updateTimeEntry(companyId, id, {
      employeeId: data.employeeId,
      payPeriodId: period.id,
      workDate: data.workDate,
      hours: data.hours,
      projectId: data.projectId,
      costCodeId: data.costCodeId,
      notes: emptyToNull(data.notes ?? null),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save time entry: ${message}` };
  }

  revalidatePath('/payroll');
  redirect(`/payroll?week=${mondayOf(data.workDate)}`);
}

export async function deleteTimeEntryAction(
  _prev: TimeEntryState,
  formData: FormData,
): Promise<TimeEntryState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to delete payroll time.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) return { formError: 'Missing time entry id.' };
  const id = idResult.data;
  const companyId = await getActiveCompanyId();

  const existing = await getTimeEntry(companyId, id);
  if (!existing) return { formError: 'Time entry not found.' };
  const periodCheck = await assertPeriodEditable(companyId, existing.payPeriodId);
  if (!periodCheck.ok) return { formError: periodCheck.reason };

  await deleteTimeEntry(companyId, id);
  revalidatePath('/payroll');
  redirect(`/payroll?week=${mondayOf(existing.workDate)}`);
}

const setStatusSchema = z.object({
  payPeriodId: idSchema,
  status: z.enum(['open', 'locked']),
});

export async function setPeriodStatusAction(input: {
  payPeriodId: string;
  status: 'open' | 'locked';
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { ok: false, error: 'No permission.' };
  }
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const companyId = await getActiveCompanyId();
  const updated = await updatePayPeriod(companyId, parsed.data.payPeriodId, {
    status: parsed.data.status,
  });
  if (!updated) return { ok: false, error: 'Period not found.' };
  revalidatePath('/payroll');
  return { ok: true };
}
