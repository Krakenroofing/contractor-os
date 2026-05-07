'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  createCostCode,
  DuplicateCostCodeError,
  setCostCodeActive,
  updateCostCode,
} from '@/lib/data/cost-codes';
import { costCodeFormSchema } from './schema';

export type CreateCostCodeState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export async function createCostCodeAction(
  _prev: CreateCostCodeState,
  formData: FormData,
): Promise<CreateCostCodeState> {
  const parsed = costCodeFormSchema.safeParse({
    code: formData.get('code'),
    description: formData.get('description'),
    category: formData.get('category'),
    division: formData.get('division'),
    sortOrder: formData.get('sortOrder'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const created = await createCostCode(companyId, {
      code: data.code,
      description: data.description,
      category: data.category,
      division: data.division ?? null,
      sortOrder: data.sortOrder,
      notes: data.notes ?? null,
    });
    createdId = created.id;
  } catch (err) {
    if (err instanceof DuplicateCostCodeError) {
      return { errors: { code: ['That code already exists in your library or the global library'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create cost code: ${message}` };
  }

  revalidatePath('/cost-codes');
  redirect(`/cost-codes/${createdId}`);
}

export type UpdateCostCodeState = {
  errors?: Record<string, string[]>;
  formError?: string;
  ok?: boolean;
};

export async function updateCostCodeAction(
  id: string,
  _prev: UpdateCostCodeState,
  formData: FormData,
): Promise<UpdateCostCodeState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) {
    return { formError: 'You do not have permission to edit cost codes.' };
  }

  const parsed = costCodeFormSchema
    .omit({ code: true })
    .safeParse({
      description: formData.get('description'),
      category: formData.get('category'),
      division: formData.get('division'),
      sortOrder: formData.get('sortOrder'),
      notes: formData.get('notes'),
    });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const updated = await updateCostCode(companyId, id, {
    description: parsed.data.description,
    category: parsed.data.category,
    division: parsed.data.division ?? null,
    sortOrder: parsed.data.sortOrder,
    notes: parsed.data.notes ?? null,
  });

  if (!updated) {
    return { formError: 'Cost code not found, or it belongs to the read-only global library.' };
  }

  revalidatePath('/cost-codes');
  revalidatePath(`/cost-codes/${id}`);
  return { ok: true };
}

export async function toggleCostCodeActiveAction(id: string, nextValue: boolean): Promise<void> {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) return;
  const companyId = await getActiveCompanyId();
  await setCostCodeActive(companyId, id, nextValue);
  revalidatePath('/cost-codes');
  revalidatePath(`/cost-codes/${id}`);
}
