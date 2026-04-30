'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { createMockEstimate, DuplicateEstimateNumberError } from '@/lib/mock-store';
import { calcEstimateTotals, lineTotal } from './lib/calc';
import { estimateFormSchema } from './schema';

export type CreateEstimateState = {
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
    const estimate = createMockEstimate(companyId, {
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
