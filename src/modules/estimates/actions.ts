'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createEstimate,
  DuplicateEstimateNumberError,
  getEstimate,
  updateEstimateHeader,
} from '@/lib/data/estimates';
import { calcEstimateTotals, lineTotal } from './lib/calc';
import { estimateFormSchema } from './schema';

export type CreateEstimateState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type UpdateEstimateHeaderState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createEstimateAction(
  _prev: CreateEstimateState,
  formData: FormData,
): Promise<CreateEstimateState> {
  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read line items.' };
  }

  const parsed = estimateFormSchema.safeParse({
    number: formData.get('number'),
    projectId: formData.get('projectId'),
    status: formData.get('status') ?? 'draft',
    validUntil: formData.get('validUntil') ?? '',
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;

  const numericLines = data.lines.map((l) => ({
    quantity: Number(l.quantity),
    unitCost: Number(l.unitCost),
    markupPercent: Number(l.markupPercent),
  }));
  const totals = calcEstimateTotals(numericLines);

  const companyId = await getActiveCompanyId();
  let createdId: string;
  try {
    const estimate = await createEstimate(companyId, {
      number: data.number,
      projectId: data.projectId,
      status: data.status,
      validUntil: emptyToNull(data.validUntil ?? null),
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
          inventoryItemId: emptyToNull(l.inventoryItemId ?? null),
          description: l.description,
          unit: emptyToNull(l.unit ?? null),
          quantity: Number(l.quantity).toFixed(4),
          unitCost: Number(l.unitCost).toFixed(4),
          markupPercent: Number(l.markupPercent).toFixed(3),
          lineTotal: sell.toFixed(2),
        };
      }),
    });
    createdId = estimate.id;
  } catch (err) {
    if (err instanceof DuplicateEstimateNumberError) {
      return { errors: { number: ['That estimate number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create estimate: ${message}` };
  }

  revalidatePath('/estimates');
  redirect(`/estimates/${createdId}`);
}

const headerUpdateSchema = z.object({
  id: z.string().uuid('Missing or invalid id'),
  validUntil: z.string().optional().or(z.literal('')),
});

export async function updateEstimateHeaderAction(
  _prev: UpdateEstimateHeaderState,
  formData: FormData,
): Promise<UpdateEstimateHeaderState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'estimates')) {
    return { formError: 'You do not have permission to edit estimates.' };
  }

  const parsed = headerUpdateSchema.safeParse({
    id: formData.get('id'),
    validUntil: formData.get('validUntil') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const existing = await getEstimate(companyId, parsed.data.id);
  if (!existing) {
    return { formError: 'Estimate not found.' };
  }
  // Once status leaves `draft` the totals and line items have been seen by
  // the customer or downstream entities. Refuse header edits past that
  // point — the workflow status panel is the right place to operate on a
  // sent / approved / rejected estimate.
  if (existing.status !== 'draft') {
    return {
      formError: `Estimate is in status "${existing.status}" — only drafts can be edited.`,
    };
  }

  try {
    const updated = await updateEstimateHeader(companyId, parsed.data.id, {
      validUntil: emptyToNull(parsed.data.validUntil ?? null),
    });
    if (!updated) return { formError: 'Estimate not found in active company.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save estimate: ${message}` };
  }

  revalidatePath('/estimates');
  revalidatePath(`/estimates/${parsed.data.id}`);
  redirect(`/estimates/${parsed.data.id}`);
}
