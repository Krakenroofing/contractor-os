'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { createMockProject, DuplicateProjectNumberError } from '@/lib/mock-store';
import { projectFormSchema } from './schema';

export type CreateProjectState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const parsed = projectFormSchema.safeParse({
    customerId: formData.get('customerId'),
    number: formData.get('number'),
    name: formData.get('name'),
    status: formData.get('status') ?? 'lead',
    jobsiteAddressLine1: formData.get('jobsiteAddressLine1') ?? '',
    jobsiteCity: formData.get('jobsiteCity') ?? '',
    jobsiteState: formData.get('jobsiteState') ?? '',
    jobsitePostalCode: formData.get('jobsitePostalCode') ?? '',
    startDate: formData.get('startDate') ?? '',
    targetCompletionDate: formData.get('targetCompletionDate') ?? '',
    contractValue: formData.get('contractValue') ?? '',
    estimatedBudget: formData.get('estimatedBudget') ?? '',
    notes: formData.get('notes') ?? '',
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const project = createMockProject(companyId, {
      customerId: data.customerId,
      number: data.number,
      name: data.name,
      status: data.status,
      jobsiteAddressLine1: emptyToNull(data.jobsiteAddressLine1 ?? null),
      jobsiteAddressLine2: null,
      jobsiteCity: emptyToNull(data.jobsiteCity ?? null),
      jobsiteState: emptyToNull(data.jobsiteState ?? null),
      jobsitePostalCode: emptyToNull(data.jobsitePostalCode ?? null),
      projectManagerId: null,
      estimatorId: null,
      startDate: emptyToNull(data.startDate ?? null),
      targetCompletionDate: emptyToNull(data.targetCompletionDate ?? null),
      actualCompletionDate: null,
      contractValue: data.contractValue,
      originalContractValue: data.contractValue,
      totalChangeOrders: '0',
      currentBudget: data.estimatedBudget,
      notes: emptyToNull(data.notes ?? null),
    });
    createdId = project.id;
  } catch (err) {
    if (err instanceof DuplicateProjectNumberError) {
      return { errors: { number: ['That project number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create project: ${message}` };
  }

  revalidatePath('/projects');
  redirect(`/projects/${createdId}`);
}
