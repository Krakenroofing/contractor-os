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
  findDayTypeEntries,
  getTimeEntry,
  updateTimeEntry,
} from '@/lib/data/time-entries';
import { getEmployee } from '@/lib/data/employees';
import { getCompany } from '@/lib/data/companies';
import {
  createJobCostEntry,
  softDeleteJobCostEntriesBySource,
  JobCostingNotAvailableInDemoError,
} from '@/lib/data/job-cost-entries';
import { getOrCreatePeriodForDate, getPayPeriod, updatePayPeriod } from '@/lib/data/pay-periods';
import {
  deletePeriodPayOverride,
  listPeriodPayOverrides,
  upsertPeriodPayOverride,
} from '@/lib/data/period-pay-overrides';
import {
  createPaystubAdjustment,
  deletePaystubAdjustment as deletePaystubAdjustmentRow,
  getPaystubAdjustment,
  listPaystubAdjustments,
} from '@/lib/data/paystub-adjustments';
import { adjustmentTypeValues } from '@/db/schema';
import {
  deletePaystubSnapshotsForPeriod,
  listPaystubSnapshots,
  replacePaystubSnapshotsForPeriod,
} from '@/lib/data/period-paystub-snapshots';
import { listEmployees } from '@/lib/data/employees';
import { listTimeEntries } from '@/lib/data/time-entries';
import {
  clearLunchOverride,
  listLunchOverrides,
  setLunchOverride,
} from '@/lib/data/timesheet-lunch';
import {
  computePeriodPaystubs,
  type EmployeePaystub,
} from './lib/payroll-math';
import { computeLaborPostingPlan } from './lib/labor-posting';
import { buildPayrollBillLines } from './lib/payroll-bill';
import { resolveGlSystemAccounts } from '@/modules/accounting/lib/gl-posting';
import {
  postJournalEntry,
  deleteJournalEntriesForSource,
} from '@/lib/data/general-ledger';
import {
  listPayrollBills,
  deletePayrollBillsForPeriod,
  insertPayrollBill,
} from '@/lib/data/payroll-bills';
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

// ===========================================================================
// Inline timesheet cell editing (Phase 2). One server action upserts a
// single day's hours OR pay value straight from the grid — no form hop.
// ===========================================================================

export type SaveCellResult = { ok?: boolean; error?: string };

const saveCellSchema = z.object({
  employeeId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['hours', 'amount']),
  // Clamp insane values; 0 means "clear this cell".
  value: z.number().nonnegative().finite().max(1_000_000),
});

/**
 * Upsert one timesheet cell. `kind='hours'` edits the day's hours row,
 * `kind='amount'` edits the day's pay row. A value of 0 clears (deletes)
 * the row. Refuses when the day already holds more than one row of that
 * type — those splits are edited on the day-detail view so allocations
 * aren't silently collapsed. New rows land unassigned (no project); the
 * office allocates from the day view as before.
 */
export async function saveTimesheetCell(input: {
  employeeId: string;
  workDate: string;
  kind: 'hours' | 'amount';
  value: number;
}): Promise<SaveCellResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { error: 'You do not have permission to edit payroll.' };
  }
  const parsed = saveCellSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid value.' };
  const { employeeId, workDate, kind, value } = parsed.data;

  const companyId = await getActiveCompanyId();
  // Never trust a client-posted employeeId — confirm it's ours.
  const employee = await getEmployee(companyId, employeeId);
  if (!employee) return { error: 'Unknown employee.' };

  const period = await getOrCreatePeriodForDate(companyId, workDate);
  if (period.status === 'locked') {
    return { error: 'That pay period is locked — unlock it before editing.' };
  }

  const existing = await findDayTypeEntries(companyId, employeeId, workDate, kind);
  if (existing.length > 1) {
    return {
      error: 'That day has multiple entries — open the day view to edit.',
    };
  }
  const row = existing[0];
  const valueStr = value.toFixed(2);

  // 0 / blank clears the cell. Deleting an hours row that was posted from
  // the clock frees the punch to re-post (FK cascades to NULL) — intended:
  // it means "these hours were removed."
  if (value <= 0) {
    if (row) await deleteTimeEntry(companyId, row.id);
    revalidatePath('/payroll');
    return { ok: true };
  }

  if (row) {
    await updateTimeEntry(companyId, row.id, {
      ...(kind === 'hours' ? { hours: valueStr } : { amount: valueStr }),
    });
  } else {
    await createTimeEntry(companyId, {
      employeeId,
      payPeriodId: period.id,
      workDate,
      entryType: kind,
      hours: kind === 'hours' ? valueStr : '0',
      amount: kind === 'amount' ? valueStr : '0',
      projectId: null,
      costCodeId: null,
      isOverhead: false,
      notes: null,
    });
  }
  revalidatePath('/payroll');
  return { ok: true };
}

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

/**
 * Inline allocation of a single time entry to a project + cost code, straight
 * from the day-detail grid — no edit-form hop. Used to job-cost day-laborer
 * day-rate entries (and any unassigned hours) so they flow into job costs.
 * Auto-submitted on change; silently no-ops on a locked period / bad input
 * (the grid is read-only when locked anyway).
 */
export async function setTimeEntryAllocationAction(
  entryId: string,
  formData: FormData,
): Promise<void> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) return;

  const idResult = idSchema.safeParse(entryId);
  if (!idResult.success) return;
  const companyId = await getActiveCompanyId();

  const existing = await getTimeEntry(companyId, idResult.data);
  if (!existing) return;
  const periodCheck = await assertPeriodEditable(companyId, existing.payPeriodId);
  if (!periodCheck.ok) return;

  const projectRaw = String(formData.get('projectId') ?? '') || null;
  const costCodeRaw = String(formData.get('costCodeId') ?? '');
  const resolved = resolveProjectSelection(projectRaw);
  const costCodeId =
    costCodeRaw && idSchema.safeParse(costCodeRaw).success ? costCodeRaw : null;

  await updateTimeEntry(companyId, idResult.data, {
    projectId: resolved.projectId,
    isOverhead: resolved.isOverhead,
    costCodeId,
  });
  revalidatePath('/payroll/day');
  revalidatePath('/payroll');
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

// =====================================================================
// Unpaid lunch break. Defaults by the day's hours (60m if >= 6h worked,
// 30m under); editing stores an override, and minutes=null resets to the
// default. Reduces paid hours → flows into gross / NIB / net / job-cost
// posting. Blocked once the period is locked.
// =====================================================================

export type LunchActionResult = { ok?: boolean; error?: string };

const lunchSchema = z.object({
  employeeId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.number().int().min(0).max(480).nullable(),
});

export async function setLunchOverrideAction(input: {
  employeeId: string;
  workDate: string;
  minutes: number | null;
}): Promise<LunchActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { error: 'You do not have permission to edit timesheets.' };
  }
  const parsed = lunchSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid lunch value.' };
  const { employeeId, workDate, minutes } = parsed.data;
  const companyId = await getActiveCompanyId();

  const period = await getOrCreatePeriodForDate(companyId, workDate);
  if (period.status === 'locked') {
    return { error: 'Period is locked — unlock it to change lunch.' };
  }
  try {
    if (minutes === null) {
      await clearLunchOverride(companyId, employeeId, workDate);
    } else {
      await setLunchOverride({
        companyId,
        employeeId,
        payPeriodId: period.id,
        workDate,
        minutes,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to save lunch: ${message}` };
  }
  revalidatePath('/payroll');
  return { ok: true };
}

// =====================================================================
// Lock / unlock period (Phase 4.9)
// =====================================================================
//
// Lock computes paystubs live one last time, writes the snapshot set
// for the period, then flips status to 'locked'. After lock, subsequent
// reads of this period reconstruct paystubs from the snapshots — so
// editing an employee's pay rate AFTER lock can't rewrite history.
//
// Unlock clears snapshots and flips status to 'open'. Used to fix
// mistakes; the computation goes live again.

export type LockPeriodState = { formError?: string };

function paystubToSnapshot(
  payPeriodId: string,
  paystub: EmployeePaystub,
): {
  payPeriodId: string;
  employeeId: string;
  employeeName: string;
  employmentType: string;
  payRate: string;
  hoursWorked: string;
  gross: string;
  adjustedGross: string;
  deductionsTotal: string;
  additionsTotal: string;
  insurableWage: string;
  employeeNib: string;
  employerNib: string;
  net: string;
  nibExempt: boolean;
  grossSource: string;
} {
  return {
    payPeriodId,
    employeeId: paystub.employeeId,
    employeeName: paystub.employeeName,
    employmentType: paystub.employmentType,
    payRate: toMoneyString(paystub.payRate),
    hoursWorked: paystub.hoursWorked.toFixed(2),
    gross: toMoneyString(paystub.gross),
    adjustedGross: toMoneyString(paystub.adjustedGross),
    deductionsTotal: toMoneyString(paystub.deductionsTotal),
    additionsTotal: toMoneyString(paystub.additionsTotal),
    insurableWage: toMoneyString(paystub.nib.insurableWage),
    employeeNib: toMoneyString(paystub.nib.employee),
    employerNib: toMoneyString(paystub.nib.employer),
    net: toMoneyString(paystub.net),
    nibExempt: paystub.nibExempt,
    grossSource: paystub.grossSource,
  };
}

export async function lockPeriodAction(
  _prev: LockPeriodState,
  formData: FormData,
): Promise<LockPeriodState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to lock pay periods.' };
  }

  const idResult = idSchema.safeParse(formData.get('payPeriodId'));
  if (!idResult.success) return { formError: 'Missing pay period id.' };
  const payPeriodId = idResult.data;
  const companyId = await getActiveCompanyId();

  const period = await getPayPeriod(companyId, payPeriodId);
  if (!period) return { formError: 'Pay period not found.' };
  if (period.status === 'locked') {
    // Already locked — surface as a no-op rather than an error so a
    // double-click on the button doesn't blow up.
    revalidatePath('/payroll');
    return {};
  }

  // Compute paystubs live ONE LAST TIME using the current rates +
  // entries + overrides + adjustments, then freeze them.
  const [employees, entries, overrides, adjustments, lunchOverrides] =
    await Promise.all([
      listEmployees(companyId),
      listTimeEntries(companyId, { payPeriodId }),
      listPeriodPayOverrides(companyId, { payPeriodId }),
      listPaystubAdjustments(companyId, { payPeriodId }),
      listLunchOverrides(companyId, payPeriodId),
    ]);
  // Pass empty snapshots so this compute runs live (we're about to
  // become the snapshot source). Lunch is applied here so the frozen
  // hours are already net of the unpaid break.
  const paystubs = computePeriodPaystubs(
    employees,
    entries,
    period,
    overrides,
    [],
    adjustments,
    lunchOverrides,
  );
  // Only snapshot rows that actually got paid (gross > 0) and weren't
  // skipped (terminated / inactive without entries). Skipped employees
  // would just clutter the locked-period view with $0 ghost rows.
  const snapshottable = paystubs.filter((p) => !p.skipped);
  const snapshotInputs = snapshottable.map((p) =>
    paystubToSnapshot(payPeriodId, p),
  );

  try {
    await replacePaystubSnapshotsForPeriod(companyId, payPeriodId, snapshotInputs);
    await updatePayPeriod(companyId, payPeriodId, { status: 'locked' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to lock period: ${message}` };
  }

  revalidatePath('/payroll');
  return {};
}

// =====================================================================
// Post labor to job costs. Spreads each employee's gross + employer NIB
// across the (project, cost code) buckets they logged time to, posting
// wages (costType 'labor') and burden (costType 'labor_burden') as
// job_cost_entries. Idempotent + reversible via source='labor_entry' +
// sourceRefId=payPeriodId. Requires a locked period and the two target
// accounts configured under Settings → Accounting.
// =====================================================================

export type PostLaborResult = {
  ok?: boolean;
  error?: string;
  summary?: { wage: number; burden: number; unposted: number; entries: number };
  reversed?: number;
};

export async function postPayrollLaborAction(
  payPeriodId: string,
): Promise<PostLaborResult> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { error: 'You do not have permission to post payroll.' };
  }
  const idResult = idSchema.safeParse(payPeriodId);
  if (!idResult.success) return { error: 'Missing pay period id.' };
  const companyId = await getActiveCompanyId();

  const company = await getCompany(companyId);
  if (!company) return { error: 'Active company not found.' };
  const laborAcct = company.laborCogsAccountId;
  const burdenAcct = company.laborBurdenAccountId;
  if (!laborAcct || !burdenAcct) {
    return {
      error:
        'Set the direct-labor and payroll-burden accounts under Settings → Accounting first.',
    };
  }

  const period = await getPayPeriod(companyId, payPeriodId);
  if (!period) return { error: 'Pay period not found.' };
  if (period.status !== 'locked') {
    return { error: 'Lock the pay period before posting its labor.' };
  }

  const [employees, entries, overrides, snapshots, adjustments] =
    await Promise.all([
      listEmployees(companyId),
      listTimeEntries(companyId, { payPeriodId }),
      listPeriodPayOverrides(companyId, { payPeriodId }),
      listPaystubSnapshots(companyId, { payPeriodId }),
      listPaystubAdjustments(companyId, { payPeriodId }),
    ]);
  const paystubs = computePeriodPaystubs(
    employees,
    entries,
    period,
    overrides,
    snapshots,
    adjustments,
  );
  const plan = computeLaborPostingPlan(paystubs, entries);
  if (plan.bucketCount === 0) {
    return {
      error:
        'Nothing to post — no labor is tagged to a project + cost code this period.',
    };
  }

  const periodLabel = `${period.startDate} – ${period.endDate}`;
  try {
    // Idempotent: reverse any prior posting for this period before re-posting.
    await softDeleteJobCostEntriesBySource(companyId, 'labor_entry', payPeriodId);

    for (const a of plan.allocations) {
      for (const b of a.buckets) {
        if (b.wage > 0) {
          await createJobCostEntry({
            companyId,
            projectId: b.projectId,
            costCodeId: b.costCodeId,
            accountingAccountId: laborAcct,
            source: 'labor_entry',
            sourceRefId: payPeriodId,
            costType: 'labor',
            entryDate: period.endDate,
            vendorId: null,
            description: `Payroll — ${a.employeeName} (${periodLabel})`,
            quantity: '1',
            unitCost: b.wage.toFixed(2),
            amount: b.wage.toFixed(2),
            isBillable: false,
            markupPercent: null,
            burdenPercent: null,
            vendorInvoiceNumber: null,
            attachmentUrl: null,
            notes: null,
            createdByUserId: user.id,
          });
        }
        if (b.burden > 0) {
          await createJobCostEntry({
            companyId,
            projectId: b.projectId,
            costCodeId: b.costCodeId,
            accountingAccountId: burdenAcct,
            source: 'labor_entry',
            sourceRefId: payPeriodId,
            costType: 'labor_burden',
            entryDate: period.endDate,
            vendorId: null,
            description: `Payroll burden (NIB) — ${a.employeeName} (${periodLabel})`,
            quantity: '1',
            unitCost: b.burden.toFixed(2),
            amount: b.burden.toFixed(2),
            isBillable: false,
            markupPercent: null,
            burdenPercent: null,
            vendorInvoiceNumber: null,
            attachmentUrl: null,
            notes: null,
            createdByUserId: user.id,
          });
        }
      }
    }
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { error: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to post labor: ${message}` };
  }

  revalidatePath('/payroll');
  revalidatePath('/reports/profit-loss', 'layout');
  return {
    ok: true,
    summary: {
      wage: plan.totalWagePosted,
      burden: plan.totalBurdenPosted,
      unposted: plan.totalUnposted,
      entries: plan.bucketCount,
    },
  };
}

export async function unpostPayrollLaborAction(
  payPeriodId: string,
): Promise<PostLaborResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { error: 'You do not have permission to unpost payroll.' };
  }
  const idResult = idSchema.safeParse(payPeriodId);
  if (!idResult.success) return { error: 'Missing pay period id.' };
  const companyId = await getActiveCompanyId();
  try {
    const reversed = await softDeleteJobCostEntriesBySource(
      companyId,
      'labor_entry',
      payPeriodId,
    );
    revalidatePath('/payroll');
    revalidatePath('/reports/profit-loss', 'layout');
    return { ok: true, reversed };
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { error: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to unpost labor: ${message}` };
  }
}

// =====================================================================
// Generate payroll bills (QuickBooks-style). One bill per paid employee for
// the (locked) period, posting the double-entry GL: Dr Payroll Expense (gross),
// Cr NIB Payable Employee/Employer, Dr NIB Expense, Dr Reimbursements, Cr AP
// (net pay). The net is the payable a bank payment later settles. Idempotent —
// regenerating replaces the period's bills + their journal entries.
// =====================================================================

export type GeneratePayrollBillsResult = {
  ok?: boolean;
  error?: string;
  count?: number;
  total?: number;
};

export async function generatePayrollBillsAction(
  payPeriodId: string,
): Promise<GeneratePayrollBillsResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { error: 'You do not have permission to post payroll.' };
  }
  const idResult = idSchema.safeParse(payPeriodId);
  if (!idResult.success) return { error: 'Missing pay period id.' };
  const companyId = await getActiveCompanyId();

  const period = await getPayPeriod(companyId, payPeriodId);
  if (!period) return { error: 'Pay period not found.' };
  if (period.status !== 'locked') {
    return { error: 'Lock the pay period before generating payroll bills.' };
  }

  const [employees, entries, overrides, snapshots, adjustments, lunch] =
    await Promise.all([
      listEmployees(companyId),
      listTimeEntries(companyId, { payPeriodId }),
      listPeriodPayOverrides(companyId, { payPeriodId }),
      listPaystubSnapshots(companyId, { payPeriodId }),
      listPaystubAdjustments(companyId, { payPeriodId }),
      listLunchOverrides(companyId, payPeriodId),
    ]);
  const paystubs = computePeriodPaystubs(
    employees,
    entries,
    period,
    overrides,
    snapshots,
    adjustments,
    lunch,
  );

  try {
    const accounts = await resolveGlSystemAccounts(companyId);

    // Idempotent: clear any prior bills + their journal entries first.
    const existing = await listPayrollBills(companyId, payPeriodId);
    for (const b of existing) {
      await deleteJournalEntriesForSource(companyId, 'payroll_bill', b.id);
    }
    await deletePayrollBillsForPeriod(companyId, payPeriodId);

    let count = 0;
    let total = 0;
    for (const p of paystubs) {
      if (p.skipped || p.net <= 0) continue;
      const amounts = {
        gross: p.gross,
        employeeNib: p.nib.employee,
        employerNib: p.nib.employer,
        additions: p.additionsTotal,
        deductions: p.deductionsTotal,
        net: p.net,
      };
      const bill = await insertPayrollBill({
        companyId,
        payPeriodId,
        employeeId: p.employeeId,
        billDate: period.endDate,
        ...amounts,
      });
      await postJournalEntry(companyId, {
        entryDate: period.endDate,
        memo: `Payroll — ${p.employeeName} (${period.startDate} – ${period.endDate})`,
        sourceType: 'payroll_bill',
        sourceId: bill.id,
        lines: buildPayrollBillLines(amounts, accounts),
      });
      count += 1;
      total += p.net;
    }

    revalidatePath('/payroll');
    revalidatePath('/reports/accounting', 'layout');
    return { ok: true, count, total: round2(total) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to generate payroll bills: ${message}` };
  }
}

// =====================================================================
// Paystub adjustments (Phase 4.10) — line-item deductions / additions
// =====================================================================

export type PaystubAdjustmentState = {
  formError?: string;
  fieldError?: string;
};

const adjustmentCreateSchema = z.object({
  employeeId: idSchema,
  payPeriodId: idSchema,
  type: z.enum(adjustmentTypeValues),
  amount: z
    .string()
    .trim()
    .refine((v) => v !== '' && !Number.isNaN(Number(v)) && Number(v) > 0, {
      message: 'Amount must be greater than zero',
    }),
  description: z.string().max(500).optional().default(''),
});

export async function addPaystubAdjustmentAction(
  _prev: PaystubAdjustmentState,
  formData: FormData,
): Promise<PaystubAdjustmentState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to edit paystub adjustments.' };
  }

  const parsed = adjustmentCreateSchema.safeParse({
    employeeId: formData.get('employeeId') ?? '',
    payPeriodId: formData.get('payPeriodId') ?? '',
    type: formData.get('type') ?? '',
    amount: formData.get('amount') ?? '',
    description: formData.get('description') ?? '',
  });
  if (!parsed.success) {
    return { fieldError: parsed.error.errors[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  const periodCheck = await assertPeriodEditable(companyId, data.payPeriodId);
  if (!periodCheck.ok) return { formError: periodCheck.reason };

  try {
    await createPaystubAdjustment(companyId, {
      employeeId: data.employeeId,
      payPeriodId: data.payPeriodId,
      type: data.type,
      amount: toMoneyString(Number(data.amount)),
      description: data.description.trim() === '' ? null : data.description.trim(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to add adjustment: ${message}` };
  }

  revalidatePath('/payroll');
  return {};
}

export async function deletePaystubAdjustmentAction(
  _prev: PaystubAdjustmentState,
  formData: FormData,
): Promise<PaystubAdjustmentState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to edit paystub adjustments.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) return { formError: 'Missing adjustment id.' };
  const companyId = await getActiveCompanyId();

  const existing = await getPaystubAdjustment(companyId, idResult.data);
  if (!existing) return { formError: 'Adjustment not found.' };

  const periodCheck = await assertPeriodEditable(companyId, existing.payPeriodId);
  if (!periodCheck.ok) return { formError: periodCheck.reason };

  await deletePaystubAdjustmentRow(companyId, idResult.data);
  revalidatePath('/payroll');
  return {};
}

export async function unlockPeriodAction(
  _prev: LockPeriodState,
  formData: FormData,
): Promise<LockPeriodState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to unlock pay periods.' };
  }

  const idResult = idSchema.safeParse(formData.get('payPeriodId'));
  if (!idResult.success) return { formError: 'Missing pay period id.' };
  const payPeriodId = idResult.data;
  const companyId = await getActiveCompanyId();

  const period = await getPayPeriod(companyId, payPeriodId);
  if (!period) return { formError: 'Pay period not found.' };
  if (period.status === 'open') {
    revalidatePath('/payroll');
    return {};
  }

  try {
    await deletePaystubSnapshotsForPeriod(companyId, payPeriodId);
    await updatePayPeriod(companyId, payPeriodId, { status: 'open' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to unlock period: ${message}` };
  }

  revalidatePath('/payroll');
  return {};
}
