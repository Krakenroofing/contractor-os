'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import {
  createChangeOrder,
  updateChangeOrder,
  DuplicateChangeOrderNumberError,
} from '@/lib/data/change-orders';
import { calcEstimateTotals, lineTotal } from '@/modules/estimates/lib/calc';
import { changeOrderFormSchema } from './schema';

export type CreateChangeOrderState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createChangeOrderAction(
  _prev: CreateChangeOrderState,
  formData: FormData,
): Promise<CreateChangeOrderState> {
  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read line items.' };
  }

  const parsed = changeOrderFormSchema.safeParse({
    number: formData.get('number'),
    projectId: formData.get('projectId'),
    proposalId: formData.get('proposalId') ?? '',
    status: formData.get('status') ?? 'draft',
    reason: formData.get('reason') ?? 'scope_change',
    description: formData.get('description'),
    scheduleImpactDays: formData.get('scheduleImpactDays') ?? '0',
    submittedAt: formData.get('submittedAt') ?? '',
    approvedAt: formData.get('approvedAt') ?? '',
    customerSignedName: formData.get('customerSignedName') ?? '',
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const totals = calcEstimateTotals(
    data.lines.map((l) => ({
      quantity: Number(l.quantity),
      unitCost: Number(l.unitCost),
      markupPercent: Number(l.markupPercent),
    })),
  );

  const companyId = await getActiveCompanyId();
  let createdId: string;
  try {
    const co = await createChangeOrder(companyId, {
      number: data.number,
      projectId: data.projectId,
      proposalId: emptyToNull(data.proposalId ?? null),
      status: data.status,
      reason: data.reason,
      description: data.description,
      scheduleImpactDays: data.scheduleImpactDays,
      submittedAt: emptyToNull(data.submittedAt ?? null),
      approvedAt:
        data.status === 'approved'
          ? emptyToNull(data.approvedAt ?? null) ?? new Date().toISOString().slice(0, 10)
          : null,
      customerSignedName:
        data.status === 'approved'
          ? emptyToNull(data.customerSignedName ?? null)
          : null,
      subtotal: totals.subtotal.toFixed(2),
      total: totals.total.toFixed(2),
      lines: data.lines.map((l) => {
        const sell = lineTotal({
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
          markupPercent: Number(l.markupPercent),
        });
        return {
          costCodeId: l.costCodeId,
          description: l.description,
          unit: emptyToNull(l.unit ?? null),
          quantity: Number(l.quantity).toFixed(4),
          unitCost: Number(l.unitCost).toFixed(4),
          markupPercent: Number(l.markupPercent).toFixed(3),
          lineTotal: sell.toFixed(2),
        };
      }),
    });
    createdId = co.id;
  } catch (err) {
    if (err instanceof DuplicateChangeOrderNumberError) {
      return { errors: { number: ['That CO number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create change order: ${message}` };
  }

  revalidatePath('/change-orders');
  revalidatePath('/projects');
  redirect(`/change-orders/${createdId}`);
}

// ---------------------------------------------------------------------------
// Update — same form schema as create, with id bound by the page route.
// ---------------------------------------------------------------------------

export async function updateChangeOrderAction(
  id: string,
  _prev: CreateChangeOrderState,
  formData: FormData,
): Promise<CreateChangeOrderState> {
  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read line items.' };
  }

  const parsed = changeOrderFormSchema.safeParse({
    number: formData.get('number'),
    projectId: formData.get('projectId'),
    proposalId: formData.get('proposalId') ?? '',
    status: formData.get('status') ?? 'draft',
    reason: formData.get('reason') ?? 'scope_change',
    description: formData.get('description'),
    scheduleImpactDays: formData.get('scheduleImpactDays') ?? '0',
    submittedAt: formData.get('submittedAt') ?? '',
    approvedAt: formData.get('approvedAt') ?? '',
    customerSignedName: formData.get('customerSignedName') ?? '',
    lines: parsedLines,
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  const totals = calcEstimateTotals(
    data.lines.map((l) => ({
      quantity: Number(l.quantity),
      unitCost: Number(l.unitCost),
      markupPercent: Number(l.markupPercent),
    })),
  );

  const companyId = await getActiveCompanyId();
  try {
    const out = await updateChangeOrder(companyId, id, {
      number: data.number,
      projectId: data.projectId,
      proposalId: emptyToNull(data.proposalId ?? null),
      status: data.status,
      reason: data.reason,
      description: data.description,
      scheduleImpactDays: data.scheduleImpactDays,
      submittedAt: emptyToNull(data.submittedAt ?? null),
      approvedAt:
        data.status === 'approved'
          ? emptyToNull(data.approvedAt ?? null) ?? new Date().toISOString().slice(0, 10)
          : null,
      customerSignedName:
        data.status === 'approved'
          ? emptyToNull(data.customerSignedName ?? null)
          : null,
      subtotal: totals.subtotal.toFixed(2),
      total: totals.total.toFixed(2),
      lines: data.lines.map((l) => {
        const sell = lineTotal({
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
          markupPercent: Number(l.markupPercent),
        });
        return {
          costCodeId: l.costCodeId,
          description: l.description,
          unit: emptyToNull(l.unit ?? null),
          quantity: Number(l.quantity).toFixed(4),
          unitCost: Number(l.unitCost).toFixed(4),
          markupPercent: Number(l.markupPercent).toFixed(3),
          lineTotal: sell.toFixed(2),
        };
      }),
    });
    if (!out) {
      return { formError: 'Change order not found, or editing is not available in demo mode.' };
    }
  } catch (err) {
    if (err instanceof DuplicateChangeOrderNumberError) {
      return { errors: { number: ['That CO number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save change order: ${message}` };
  }

  revalidatePath('/change-orders');
  revalidatePath(`/change-orders/${id}`);
  revalidatePath('/projects');
  redirect(`/change-orders/${id}`);
}
