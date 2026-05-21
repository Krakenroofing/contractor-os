'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createSubcontractorPayment,
  deleteSubcontractorPayment,
  getSubcontractorPayment,
  updateSubcontractorPayment,
} from '@/lib/data/subcontractor-payments';
import { toMoneyString } from '@/lib/money';
import {
  computeNetPaid,
  computeRetainageHeld,
  parseMoneySafe,
  parsePercentSafe,
} from './lib/math';
import { subPaymentFormSchema } from './schema';

export type SubPaymentState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function readForm(formData: FormData) {
  return {
    vendorId: formData.get('vendorId') ?? '',
    projectId: formData.get('projectId') ?? '',
    workPeriodStart: formData.get('workPeriodStart') ?? '',
    workPeriodEnd: formData.get('workPeriodEnd') ?? '',
    scopeDescription: formData.get('scopeDescription') ?? '',
    grossAmount: formData.get('grossAmount') ?? '0',
    retainagePercent: formData.get('retainagePercent') ?? '0',
    retainageHeld: formData.get('retainageHeld') ?? '',
    paidDate: formData.get('paidDate') ?? '',
    status: formData.get('status') ?? 'draft',
    notes: formData.get('notes') ?? '',
  };
}

/**
 * Final-pass retainage math. The form posts retainagePercent and
 * (optionally) an explicit retainageHeld. If retainageHeld is blank we
 * compute it from gross × percent. Net is always gross − held so it
 * doesn't drift.
 */
function finalizeMath(input: {
  grossAmount: string;
  retainagePercent: string;
  retainageHeld?: string;
}): {
  grossAmount: string;
  retainagePercent: string;
  retainageHeld: string;
  netPaid: string;
} {
  const gross = parseMoneySafe(input.grossAmount);
  const pct = parsePercentSafe(input.retainagePercent);
  const explicitHeld = input.retainageHeld ?? '';
  const held = explicitHeld.trim() === ''
    ? computeRetainageHeld(gross, pct)
    : parseMoneySafe(explicitHeld);
  const net = computeNetPaid(gross, held);
  return {
    grossAmount: toMoneyString(gross),
    retainagePercent: pct.toFixed(3),
    retainageHeld: toMoneyString(held),
    netPaid: toMoneyString(net),
  };
}

export async function createSubPaymentAction(
  _prev: SubPaymentState,
  formData: FormData,
): Promise<SubPaymentState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to create sub-payments.' };
  }

  const parsed = subPaymentFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const math = finalizeMath({
    grossAmount: data.grossAmount,
    retainagePercent: data.retainagePercent,
    retainageHeld: data.retainageHeld,
  });

  let createdId: string;
  try {
    const row = await createSubcontractorPayment(companyId, {
      vendorId: data.vendorId,
      projectId: data.projectId,
      workPeriodStart: data.workPeriodStart,
      workPeriodEnd: data.workPeriodEnd,
      scopeDescription: data.scopeDescription,
      grossAmount: math.grossAmount,
      retainagePercent: math.retainagePercent,
      retainageHeld: math.retainageHeld,
      netPaid: math.netPaid,
      paidDate: emptyToNull(data.paidDate ?? null),
      status: data.status,
      notes: emptyToNull(data.notes ?? null),
    });
    createdId = row.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save sub-payment: ${message}` };
  }

  revalidatePath('/payroll');
  redirect(`/payroll?view=subs`);
}

const idSchema = z.string().uuid('Missing or invalid id');

export async function updateSubPaymentAction(
  _prev: SubPaymentState,
  formData: FormData,
): Promise<SubPaymentState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to edit sub-payments.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) return { formError: 'Missing id.' };
  const id = idResult.data;

  const parsed = subPaymentFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const math = finalizeMath({
    grossAmount: data.grossAmount,
    retainagePercent: data.retainagePercent,
    retainageHeld: data.retainageHeld,
  });

  try {
    const updated = await updateSubcontractorPayment(companyId, id, {
      vendorId: data.vendorId,
      projectId: data.projectId,
      workPeriodStart: data.workPeriodStart,
      workPeriodEnd: data.workPeriodEnd,
      scopeDescription: data.scopeDescription,
      grossAmount: math.grossAmount,
      retainagePercent: math.retainagePercent,
      retainageHeld: math.retainageHeld,
      netPaid: math.netPaid,
      paidDate: emptyToNull(data.paidDate ?? null),
      status: data.status,
      notes: emptyToNull(data.notes ?? null),
    });
    if (!updated) return { formError: 'Sub-payment not found.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save sub-payment: ${message}` };
  }

  revalidatePath('/payroll');
  redirect(`/payroll?view=subs`);
}

export async function deleteSubPaymentAction(
  _prev: SubPaymentState,
  formData: FormData,
): Promise<SubPaymentState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) {
    return { formError: 'You do not have permission to delete sub-payments.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) return { formError: 'Missing id.' };
  const id = idResult.data;
  const companyId = await getActiveCompanyId();

  const existing = await getSubcontractorPayment(companyId, id);
  if (!existing) return { formError: 'Sub-payment not found.' };

  await deleteSubcontractorPayment(companyId, id);
  revalidatePath('/payroll');
  redirect(`/payroll?view=subs`);
}
