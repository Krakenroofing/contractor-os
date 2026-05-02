'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { createCostCode, DuplicateCostCodeError } from '@/lib/data/cost-codes';
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
    });
    createdId = created.id;
  } catch (err) {
    if (err instanceof DuplicateCostCodeError) {
      return { errors: { code: ['That code is already in the library'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create cost code: ${message}` };
  }

  revalidatePath('/cost-codes');
  redirect(`/cost-codes/${createdId}`);
}
