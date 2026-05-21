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
import {
  deletePeriodPayOverride,
  upsertPeriodPayOverride,
} from '@/lib/data/period-pay-overrides';
import {
  multiply,
  parseMoney,
  round2,
  round4,
  toMoneyString,
} from '@/lib/money';
import { mondayOf } from './lib/periods';
import {
  OVERHEAD_VALUE,
  timeEntryCreateSchema,
  timeEntryEditSchema,
  type TimeEntryAllocation,
} from './schema';

export type TimeEntryState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

/**
 * Read the allocation rows posted by the multi-allocation widget.
 * Keys look like `allocations[0].projectId`, `allocations[0].costCodeId`,
 * `allocations[0].percent`, and so on per row. Missing rows are skipped
 * — Zod validates the array has at least one entry.
 */
function readAllocations(formData: FormData): unknown[] {
  const rows: Record<number, Record<string, string>> = {};
  const keyPattern =
    /^allocations\[(\d+)\]\.(projectId|costCodeId|percent)$/;
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue;
    const match = keyPattern.exec(key);
    if (!match) continue;
    const idx = Number(match[1]);
    const field = match[2];
    (rows[idx] ??= {})[field] = value;
  }
  return Object.keys(rows)
    .map(Number)
    .sort((a, b) => a - b)
    .map((idx) => rows[idx]);
}

function readCreateForm(formData: FormData) {
  return {
    employeeId: formData.get('employeeId') ?? '',
    workDate: formData.get('workDate') ?? '',
    entryType: formData.get('entryType') ?? 'hours',
    hours: formData.get('hours') ?? '',
    amount: formData.get('amount') ?? '',
    notes: formData.get('notes') ?? '',
    allocations: readAllocations(formData),
  };
}

function readEditForm(formData: FormData) {
  return {
    employeeId: formData.get('employeeId') ?? '',
    workDate: formData.get('workDate') ?? '',
    entryType: formData.get('entryType') ?? 'hours',
    hours: formData.get('hours') ?? '',
    amount: formData.get('amount') ?? '',
    projectId: formData.get('projectId') ?? '',
    costCodeId: formData.get('costCodeId') ?? '',
    notes: formData.get('notes') ?? '',
  };
}

/**
 * Resolve a project selection ('UUID' | OVERHEAD_VALUE | null) into the
 * pair of DB columns (project_id, is_overhead) it maps to.
 */
function resolveProjectSelection(
  projectId: string | null,
): { projectId: string | null; isOverhead: boolean } {
  if (projectId === OVERHEAD_VALUE) {
    return { projectId: null, isOverhead: true };
  }
  return { projectId, isOverhead: false };
}

/**
 * Split a total (hours or amount) across allocations weighted by their
 * percents. Uses a "last row absorbs the rounding residue" approach so
 * the rows always sum exactly back to the input — no $0.01 leakage.
 */
function splitByPercent(
  total: number,
  allocations: TimeEntryAllocation[],
  decimals: 2 | 4,
): number[] {
  const result: number[] = new Array(allocations.length).fill(0);
  if (allocations.length === 0) return result;
  let runningSum = 0;
  for (let i = 0; i < allocations.length - 1; i++) {
    const share = (allocations[i].percent / 100) * total;
    const rounded = decimals === 2 ? round2(share) : round4(share);
    result[i] = rounded;
    runningSum += rounded;
  }
  // Last row gets the residue so the splits sum exactly to total.
  const last =
    decimals === 2 ? round2(total - runningSum) : round4(total - runningSum);
  result[allocations.length - 1] = last;
  return result;
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

  const parsed = timeEntryCreateSchema.safeParse(readCreateForm(formData));
  if (!parsed.success) {
    // Surface allocations errors on the formError channel since they
    // aren't keyed to a single named field.
    const flat = parsed.error.flatten();
    const allocationError =
      flat.formErrors[0] ?? flat.fieldErrors.allocations?.[0];
    if (allocationError) {
      return {
        formError: allocationError,
        errors: flat.fieldErrors,
      };
    }
    return { errors: flat.fieldErrors };
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

  // Split the total hours / amount across the allocations. Last row
  // absorbs rounding residue so the splits sum exactly back to the
  // original total — no $0.01 leakage.
  const totalHours = data.entryType === 'hours' ? parseMoney(data.hours) : 0;
  const totalAmount =
    data.entryType === 'amount' ? parseMoney(data.amount) : 0;
  const hoursSplits = splitByPercent(totalHours, data.allocations, 4);
  const amountSplits = splitByPercent(totalAmount, data.allocations, 2);
  const notes = emptyToNull(data.notes ?? null);

  try {
    for (let i = 0; i < data.allocations.length; i++) {
      const alloc = data.allocations[i];
      const resolved = resolveProjectSelection(alloc.projectId);
      await createTimeEntry(companyId, {
        employeeId: data.employeeId,
        payPeriodId: period.id,
        workDate: data.workDate,
        entryType: data.entryType,
        hours: data.entryType === 'hours' ? hoursSplits[i].toFixed(4) : '0',
        amount:
          data.entryType === 'amount' ? amountSplits[i].toFixed(2) : '0',
        projectId: resolved.projectId,
        costCodeId: alloc.costCodeId,
        isOverhead: resolved.isOverhead,
        notes,
      });
    }
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

  const parsed = timeEntryEditSchema.safeParse(readEditForm(formData));
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

  const resolved = resolveProjectSelection(data.projectId);

  try {
    await updateTimeEntry(companyId, id, {
      employeeId: data.employeeId,
      payPeriodId: period.id,
      workDate: data.workDate,
      entryType: data.entryType,
      hours: data.entryType === 'hours' ? data.hours : '0',
      amount: data.entryType === 'amount' ? data.amount : '0',
      projectId: resolved.projectId,
      costCodeId: data.costCodeId,
      isOverhead: resolved.isOverhead,
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

// =====================================================================
// Period pay overrides (Phase 4.6) — set / clear manual gross pay for
// one employee for one period.
// =====================================================================

export type PayOverrideState = {
  formError?: string;
  fieldError?: string;
};

const payOverrideSchema = z.object({
  employeeId: idSchema,
  payPeriodId: idSchema,
  grossAmount: z
    .string()
    .trim()
    .refine((v) => v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
      message: 'Gross must be a non-negative number',
    }),
  notes: z.string().max(2000).optional().default(''),
});

/** Save / update a single pay override. Used by the inline editor on
 *  each paystub card. */
export async function savePayOverrideAction(
  _prev: PayOverrideState,
  formData: FormData,
): Promise<PayOverrideState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to set pay overrides.' };
  }

  const parsed = payOverrideSchema.safeParse({
    employeeId: formData.get('employeeId') ?? '',
    payPeriodId: formData.get('payPeriodId') ?? '',
    grossAmount: formData.get('grossAmount') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { fieldError: parsed.error.errors[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  // Period lock check — don't let overrides land in a locked period.
  const periodCheck = await assertPeriodEditable(companyId, data.payPeriodId);
  if (!periodCheck.ok) return { formError: periodCheck.reason };

  try {
    await upsertPeriodPayOverride(companyId, {
      employeeId: data.employeeId,
      payPeriodId: data.payPeriodId,
      grossAmount: toMoneyString(Number(data.grossAmount)),
      notes: data.notes.trim() === '' ? null : data.notes.trim(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save override: ${message}` };
  }

  revalidatePath('/payroll');
  return {};
}

/** Remove an existing override — reverts the employee to their stored
 *  rate (or to $0 for piecework/contract/commission/lump_sum without an
 *  override). */
export async function clearPayOverrideAction(
  _prev: PayOverrideState,
  formData: FormData,
): Promise<PayOverrideState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to clear pay overrides.' };
  }

  const empResult = idSchema.safeParse(formData.get('employeeId'));
  const periodResult = idSchema.safeParse(formData.get('payPeriodId'));
  if (!empResult.success || !periodResult.success) {
    return { formError: 'Missing employee or period id.' };
  }
  const companyId = await getActiveCompanyId();

  const periodCheck = await assertPeriodEditable(companyId, periodResult.data);
  if (!periodCheck.ok) return { formError: periodCheck.reason };

  await deletePeriodPayOverride(
    companyId,
    empResult.data,
    periodResult.data,
  );
  revalidatePath('/payroll');
  return {};
}

/** Batch upsert from the Pay Run tab. The form posts one
 *  `employee:<id>` entry per row; the value is that employee's gross.
 *  Empty strings clear the override; non-empty save it. */
export async function savePayRunAction(
  _prev: PayOverrideState,
  formData: FormData,
): Promise<PayOverrideState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to run payroll.' };
  }

  const periodResult = idSchema.safeParse(formData.get('payPeriodId'));
  if (!periodResult.success) return { formError: 'Missing period id.' };
  const payPeriodId = periodResult.data;
  const companyId = await getActiveCompanyId();

  const periodCheck = await assertPeriodEditable(companyId, payPeriodId);
  if (!periodCheck.ok) return { formError: periodCheck.reason };

  // Collect all employee:<id> entries from the form.
  const entries: { employeeId: string; rawAmount: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue;
    if (!key.startsWith('employee:')) continue;
    const employeeId = key.slice('employee:'.length);
    if (!/^[0-9a-f-]{36}$/i.test(employeeId)) continue;
    entries.push({ employeeId, rawAmount: value.trim() });
  }

  for (const e of entries) {
    if (e.rawAmount === '') {
      // Empty → clear any existing override for this employee in this
      // period (employee falls back to rate-based gross or $0).
      await deletePeriodPayOverride(companyId, e.employeeId, payPeriodId);
      continue;
    }
    const num = Number(e.rawAmount);
    if (!Number.isFinite(num) || num < 0) {
      // Skip invalid rows silently — the form's per-row validation
      // catches this earlier; this is just a defensive guard.
      continue;
    }
    await upsertPeriodPayOverride(companyId, {
      employeeId: e.employeeId,
      payPeriodId,
      grossAmount: toMoneyString(num),
      notes: null,
    });
  }

  revalidatePath('/payroll');
  // After save the same Pay Run tab should reload so the user sees
  // their entries reflected back in the paystub previews.
  redirect(`/payroll?week=${mondayOf((await getPayPeriod(companyId, payPeriodId))!.startDate)}&view=pay-run`);
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
