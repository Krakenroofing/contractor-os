'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import {
  createJobCostEntry,
  getJobCostEntry,
  softDeleteJobCostEntry,
  updateJobCostEntry,
  JobCostingNotAvailableInDemoError,
} from '@/lib/data/job-cost-entries';
import {
  upsertJobCostForecast,
  softDeleteJobCostForecast,
  JobCostingForecastsNotAvailableInDemoError,
} from '@/lib/data/job-cost-forecasts';
import {
  costEntryFormSchema,
  jobCostTypeValues,
  laborEntryFormSchema,
  equipmentEntryFormSchema,
  vendorExpenseFormSchema,
  forecastFormSchema,
  EQUIPMENT_RATE_BASIS_LABEL,
} from './schema';

export type CostEntryActionState = {
  formError?: string;
  errors?: Record<string, string[]>;
  ok?: boolean;
};

const idSchema = z.string().uuid('Missing or invalid id');

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function readForm(formData: FormData) {
  return {
    entryDate: (formData.get('entryDate') ?? '').toString(),
    costCodeId: (formData.get('costCodeId') ?? '').toString(),
    costType: (formData.get('costType') ?? 'other').toString(),
    vendorId: (formData.get('vendorId') ?? '').toString(),
    description: (formData.get('description') ?? '').toString(),
    quantity: (formData.get('quantity') ?? '1').toString(),
    unitCost: (formData.get('unitCost') ?? '0').toString(),
    amount: (formData.get('amount') ?? '').toString(),
    isBillable:
      formData.get('isBillable') === 'on' || formData.get('isBillable') === 'true',
    markupPercent: (formData.get('markupPercent') ?? '').toString(),
    notes: (formData.get('notes') ?? '').toString(),
  };
}

// Derive amount = quantity * unitCost when the user didn't paste a total.
// Numerics are stored as 2-decimal strings to match drizzle's `numeric(14,2)`.
function deriveAmount(quantity: string, unitCost: string, override: string): string {
  if (override.trim() !== '') {
    const o = Number(override);
    if (Number.isFinite(o)) return o.toFixed(2);
  }
  const q = Number(quantity);
  const u = Number(unitCost);
  const total = Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
  return total.toFixed(2);
}

export async function createCostEntryAction(
  projectId: string,
  _prev: CostEntryActionState,
  formData: FormData,
): Promise<CostEntryActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to add job cost entries.' };
  }
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return { formError: 'Project not found in the active company.' };

  const parsed = costEntryFormSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  if (!(jobCostTypeValues as readonly string[]).includes(data.costType)) {
    return { formError: 'Unknown cost type.' };
  }

  const amount = deriveAmount(data.quantity, data.unitCost, data.amount ?? '');
  // Reject zero/negative entries — accidental "save empty form" guard.
  if (Number(amount) === 0) {
    return {
      errors: { amount: ['Amount must be greater than zero.'] },
    };
  }

  try {
    await createJobCostEntry({
      companyId,
      projectId: project.id,
      costCodeId: data.costCodeId,
      // Phase 2 accounting: manual entries don't inherit a category from a
      // source receipt. Future Phase 2.x wires the AccountingAccountPicker
      // into the manual job-cost entry forms so users can pick one here.
      accountingAccountId: null,
      source: 'manual',
      sourceRefId: null,
      costType: data.costType,
      entryDate: data.entryDate,
      vendorId: emptyToNull(data.vendorId),
      description: data.description,
      quantity: Number(data.quantity).toFixed(4),
      unitCost: Number(data.unitCost).toFixed(4),
      amount,
      isBillable: data.isBillable,
      markupPercent:
        data.markupPercent && data.markupPercent.trim() !== ''
          ? Number(data.markupPercent).toFixed(3)
          : null,
      burdenPercent: null,
      vendorInvoiceNumber: null,
      attachmentUrl: null,
      notes: emptyToNull(data.notes),
      createdByUserId: user.id,
    });
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save cost entry: ${message}` };
  }

  revalidatePath(`/job-costing/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function updateCostEntryAction(
  projectId: string,
  entryId: string,
  _prev: CostEntryActionState,
  formData: FormData,
): Promise<CostEntryActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to edit job cost entries.' };
  }
  const idCheck = idSchema.safeParse(entryId);
  if (!idCheck.success) return { formError: 'Missing or invalid entry id.' };
  const companyId = await getActiveCompanyId();

  const parsed = costEntryFormSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  const amount = deriveAmount(data.quantity, data.unitCost, data.amount ?? '');
  if (Number(amount) === 0) {
    return { errors: { amount: ['Amount must be greater than zero.'] } };
  }

  try {
    const updated = await updateJobCostEntry(companyId, entryId, {
      costCodeId: data.costCodeId,
      costType: data.costType,
      vendorId: emptyToNull(data.vendorId),
      entryDate: data.entryDate,
      description: data.description,
      quantity: Number(data.quantity).toFixed(4),
      unitCost: Number(data.unitCost).toFixed(4),
      amount,
      isBillable: data.isBillable,
      markupPercent:
        data.markupPercent && data.markupPercent.trim() !== ''
          ? Number(data.markupPercent).toFixed(3)
          : null,
      notes: emptyToNull(data.notes),
    });
    if (!updated) return { formError: 'Cost entry not found.' };
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save cost entry: ${message}` };
  }

  revalidatePath(`/job-costing/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function deleteCostEntryAction(
  projectId: string,
  entryId: string,
  _prev: CostEntryActionState,
  _formData: FormData,
): Promise<CostEntryActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to delete job cost entries.' };
  }
  const idCheck = idSchema.safeParse(entryId);
  if (!idCheck.success) return { formError: 'Missing or invalid entry id.' };
  const companyId = await getActiveCompanyId();

  const existing = await getJobCostEntry(companyId, entryId);
  if (!existing) return { formError: 'Cost entry not found.' };

  try {
    await softDeleteJobCostEntry(companyId, entryId);
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to delete cost entry: ${message}` };
  }
  revalidatePath(`/job-costing/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

// =============================================================================
// Phase 2 — specialized entry actions
//
// All three (labor / equipment / vendor expense) ultimately insert one or more
// rows into job_cost_entries. The forms are convenience wrappers; the ledger
// is uniform.
// =============================================================================

function revalidateProject(projectId: string) {
  revalidatePath(`/job-costing/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
}

// --- Labor ------------------------------------------------------------------

export async function createLaborEntryAction(
  projectId: string,
  _prev: CostEntryActionState,
  formData: FormData,
): Promise<CostEntryActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to add labor entries.' };
  }
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return { formError: 'Project not found in the active company.' };

  const parsed = laborEntryFormSchema.safeParse({
    entryDate: (formData.get('entryDate') ?? '').toString(),
    costCodeId: (formData.get('costCodeId') ?? '').toString(),
    crewCompany: (formData.get('crewCompany') ?? '').toString(),
    workerName: (formData.get('workerName') ?? '').toString(),
    trade: (formData.get('trade') ?? '').toString(),
    workerCount: (formData.get('workerCount') ?? '1').toString(),
    hours: (formData.get('hours') ?? '0').toString(),
    hourlyRate: (formData.get('hourlyRate') ?? '0').toString(),
    burdenPercent: (formData.get('burdenPercent') ?? '').toString(),
    notes: (formData.get('notes') ?? '').toString(),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  const hoursNum = Number(data.hours);
  const rateNum = Number(data.hourlyRate);
  const burdenNum =
    data.burdenPercent && data.burdenPercent.trim() !== ''
      ? Number(data.burdenPercent)
      : 0;
  const subtotal = hoursNum * rateNum;
  const amount = subtotal * (1 + burdenNum / 100);
  if (amount <= 0) {
    return { errors: { hours: ['Hours × rate must be greater than zero.'] } };
  }

  const descParts = [
    data.workerName,
    data.trade ? `(${data.trade})` : null,
    data.crewCompany ? `· ${data.crewCompany}` : null,
    `${data.workerCount} worker${data.workerCount === 1 ? '' : 's'} × ${hoursNum} hr @ $${rateNum.toFixed(2)}/hr`,
    burdenNum > 0 ? `+${burdenNum}% burden` : null,
  ].filter(Boolean);

  try {
    await createJobCostEntry({
      companyId,
      projectId: project.id,
      costCodeId: data.costCodeId,
      // Phase 2 accounting: manual entries don't inherit a category from a
      // source receipt. Future Phase 2.x wires the AccountingAccountPicker
      // into the manual job-cost entry forms so users can pick one here.
      accountingAccountId: null,
      source: 'manual',
      sourceRefId: null,
      costType: 'labor',
      entryDate: data.entryDate,
      vendorId: null,
      description: descParts.join(' '),
      quantity: hoursNum.toFixed(4),
      unitCost: rateNum.toFixed(4),
      amount: amount.toFixed(2),
      isBillable: false,
      markupPercent: null,
      burdenPercent: burdenNum > 0 ? burdenNum.toFixed(3) : null,
      vendorInvoiceNumber: null,
      attachmentUrl: null,
      notes: emptyToNull(data.notes),
      createdByUserId: user.id,
    });
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save labor entry: ${message}` };
  }

  revalidateProject(projectId);
  return { ok: true };
}

// --- Equipment --------------------------------------------------------------

export async function createEquipmentEntryAction(
  projectId: string,
  _prev: CostEntryActionState,
  formData: FormData,
): Promise<CostEntryActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to add equipment entries.' };
  }
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return { formError: 'Project not found in the active company.' };

  const parsed = equipmentEntryFormSchema.safeParse({
    entryDate: (formData.get('entryDate') ?? '').toString(),
    costCodeId: (formData.get('costCodeId') ?? '').toString(),
    ownership: (formData.get('ownership') ?? 'rented').toString(),
    equipmentName: (formData.get('equipmentName') ?? '').toString(),
    vendorId: (formData.get('vendorId') ?? '').toString(),
    rateBasis: (formData.get('rateBasis') ?? 'day').toString(),
    rate: (formData.get('rate') ?? '0').toString(),
    units: (formData.get('units') ?? '1').toString(),
    notes: (formData.get('notes') ?? '').toString(),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  const rateNum = Number(data.rate);
  const unitsNum = Number(data.units);
  const amount = rateNum * unitsNum;
  if (amount <= 0) {
    return { errors: { rate: ['Rate × units must be greater than zero.'] } };
  }

  const costType = data.ownership === 'owned' ? 'owned_equipment' : 'equipment_rental';
  const basisLabel = EQUIPMENT_RATE_BASIS_LABEL[data.rateBasis];
  const description = `${data.equipmentName} — ${unitsNum} × ${basisLabel.toLowerCase()} @ $${rateNum.toFixed(2)}`;

  try {
    await createJobCostEntry({
      companyId,
      projectId: project.id,
      costCodeId: data.costCodeId,
      // Phase 2 accounting: manual entries don't inherit a category from a
      // source receipt. Future Phase 2.x wires the AccountingAccountPicker
      // into the manual job-cost entry forms so users can pick one here.
      accountingAccountId: null,
      source: 'manual',
      sourceRefId: null,
      costType,
      entryDate: data.entryDate,
      vendorId: emptyToNull(data.vendorId),
      description,
      quantity: unitsNum.toFixed(4),
      unitCost: rateNum.toFixed(4),
      amount: amount.toFixed(2),
      isBillable: false,
      markupPercent: null,
      burdenPercent: null,
      vendorInvoiceNumber: null,
      attachmentUrl: null,
      notes: emptyToNull(data.notes),
      createdByUserId: user.id,
    });
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save equipment entry: ${message}` };
  }

  revalidateProject(projectId);
  return { ok: true };
}

// --- Vendor expense ---------------------------------------------------------

export async function createVendorExpenseAction(
  projectId: string,
  _prev: CostEntryActionState,
  formData: FormData,
): Promise<CostEntryActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to add vendor expenses.' };
  }
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return { formError: 'Project not found in the active company.' };

  const parsed = vendorExpenseFormSchema.safeParse({
    entryDate: (formData.get('entryDate') ?? '').toString(),
    vendorId: (formData.get('vendorId') ?? '').toString(),
    invoiceNumber: (formData.get('invoiceNumber') ?? '').toString(),
    costCodeId: (formData.get('costCodeId') ?? '').toString(),
    subtotalCostType: (formData.get('subtotalCostType') ?? 'materials').toString(),
    description: (formData.get('description') ?? '').toString(),
    subtotal: (formData.get('subtotal') ?? '0').toString(),
    vatPercent: (formData.get('vatPercent') ?? '').toString(),
    freightAmount: (formData.get('freightAmount') ?? '').toString(),
    dutyAmount: (formData.get('dutyAmount') ?? '').toString(),
    notes: (formData.get('notes') ?? '').toString(),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  const subtotalNum = Number(data.subtotal);
  if (subtotalNum <= 0) {
    return { errors: { subtotal: ['Subtotal must be greater than zero.'] } };
  }

  const vatPct = data.vatPercent?.trim() ? Number(data.vatPercent) : 0;
  const freightNum = data.freightAmount?.trim() ? Number(data.freightAmount) : 0;
  const dutyNum = data.dutyAmount?.trim() ? Number(data.dutyAmount) : 0;

  // Build the rows we're about to insert. All share vendor + invoice #.
  type Row = {
    costType: typeof data.subtotalCostType;
    amount: number;
    description: string;
  };
  const rows: Row[] = [
    {
      costType: data.subtotalCostType,
      amount: subtotalNum,
      description: data.description,
    },
  ];
  if (vatPct > 0) {
    rows.push({
      costType: 'vat',
      amount: subtotalNum * (vatPct / 100),
      description: `VAT (${vatPct}%) on ${data.invoiceNumber}`,
    });
  }
  if (freightNum > 0) {
    rows.push({
      costType: 'freight',
      amount: freightNum,
      description: `Freight on ${data.invoiceNumber}`,
    });
  }
  if (dutyNum > 0) {
    rows.push({
      costType: 'customs_duty',
      amount: dutyNum,
      description: `Customs duty on ${data.invoiceNumber}`,
    });
  }

  try {
    for (const r of rows) {
      await createJobCostEntry({
        companyId,
        projectId: project.id,
        costCodeId: data.costCodeId,
        // Phase 2 accounting: see note in the sibling actions above.
        accountingAccountId: null,
        source: 'manual',
        sourceRefId: null,
        costType: r.costType,
        entryDate: data.entryDate,
        vendorId: data.vendorId,
        description: r.description,
        quantity: '1.0000',
        unitCost: r.amount.toFixed(4),
        amount: r.amount.toFixed(2),
        isBillable: false,
        markupPercent: null,
        burdenPercent: null,
        vendorInvoiceNumber: data.invoiceNumber,
        attachmentUrl: null,
        notes: emptyToNull(data.notes),
        createdByUserId: user.id,
      });
    }
  } catch (err) {
    if (err instanceof JobCostingNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save vendor expense: ${message}` };
  }

  revalidateProject(projectId);
  return { ok: true };
}

// --- Forecast ---------------------------------------------------------------

export type ForecastActionState = {
  formError?: string;
  errors?: Record<string, string[]>;
  ok?: boolean;
};

export async function upsertForecastAction(
  projectId: string,
  _prev: ForecastActionState,
  formData: FormData,
): Promise<ForecastActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to set forecasts.' };
  }
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return { formError: 'Project not found in the active company.' };

  const parsed = forecastFormSchema.safeParse({
    costCodeId: (formData.get('costCodeId') ?? '').toString(),
    costToComplete: (formData.get('costToComplete') ?? '0').toString(),
    notes: (formData.get('notes') ?? '').toString(),
    riskFlag:
      formData.get('riskFlag') === 'on' || formData.get('riskFlag') === 'true',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  try {
    await upsertJobCostForecast({
      companyId,
      projectId: project.id,
      costCodeId: data.costCodeId,
      costToComplete: Number(data.costToComplete).toFixed(2),
      notes: emptyToNull(data.notes),
      riskFlag: data.riskFlag,
      updatedByUserId: user.id,
    });
  } catch (err) {
    if (err instanceof JobCostingForecastsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save forecast: ${message}` };
  }

  revalidateProject(projectId);
  return { ok: true };
}

export async function deleteForecastAction(
  projectId: string,
  forecastId: string,
  _prev: ForecastActionState,
  _formData: FormData,
): Promise<ForecastActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'job_costing')) {
    return { formError: 'You do not have permission to delete forecasts.' };
  }
  const idCheck = idSchema.safeParse(forecastId);
  if (!idCheck.success) return { formError: 'Missing or invalid forecast id.' };
  const companyId = await getActiveCompanyId();

  try {
    const out = await softDeleteJobCostForecast(companyId, forecastId);
    if (!out) return { formError: 'Forecast not found.' };
  } catch (err) {
    if (err instanceof JobCostingForecastsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to delete forecast: ${message}` };
  }

  revalidateProject(projectId);
  return { ok: true };
}
