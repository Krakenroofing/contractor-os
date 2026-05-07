'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createProject,
  softDeleteProject,
  updateProject,
} from '@/lib/data/projects';
import { DuplicateProjectNumberError } from '@/lib/mock-store';
import { projectFormSchema } from './schema';

export type CreateProjectState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type UpdateProjectState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type ArchiveProjectState = {
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function readForm(formData: FormData) {
  return {
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
  };
}

export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { formError: 'You do not have permission to create projects.' };
  }

  const parsed = projectFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const project = await createProject(companyId, {
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

const idSchema = z.string().uuid('Missing or invalid id');

export async function updateProjectAction(
  _prev: UpdateProjectState,
  formData: FormData,
): Promise<UpdateProjectState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { formError: 'You do not have permission to edit projects.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing project id on the form.' };
  }
  const id = idResult.data;

  const parsed = projectFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  // Note: we deliberately do NOT update `number` (immutable display id) or
  // `originalContractValue` (kept as audit trail). `currentBudget` follows
  // the form's estimatedBudget field exactly like create. Change orders
  // continue to flow through their own action; we don't touch
  // `totalChangeOrders` here.
  try {
    const updated = await updateProject(companyId, id, {
      customerId: data.customerId,
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
      currentBudget: data.estimatedBudget,
      notes: emptyToNull(data.notes ?? null),
    });
    if (!updated) {
      return { formError: 'Project not found in the active company.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save project: ${message}` };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

export async function archiveProjectAction(
  _prev: ArchiveProjectState,
  formData: FormData,
): Promise<ArchiveProjectState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { formError: 'You do not have permission to archive projects.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing project id.' };
  }
  const id = idResult.data;
  const companyId = await getActiveCompanyId();

  try {
    const removed = await softDeleteProject(companyId, id);
    if (!removed) {
      return { formError: 'Project not found.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to archive project: ${message}` };
  }

  revalidatePath('/projects');
  redirect('/projects');
}
