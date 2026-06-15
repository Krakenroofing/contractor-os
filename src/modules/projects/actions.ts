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
import { recomputeProjectContractTotalsFromCOs } from '@/lib/data/change-orders';
import { projectFormSchema, projectStatusValues } from './schema';

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create project: ${message}` };
  }

  revalidatePath('/projects');
  redirect(`/projects/${createdId}`);
}

// Returned to the inline "+ Add new project" pickers.
export type InlineProject = { id: string; name: string; customerId: string };

export type InlineCreateProjectResult =
  | { ok: true; project: InlineProject }
  | { ok: false; error?: string; errors?: Record<string, string[]> };

const inlineProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(200),
  customerId: z.string().uuid('Pick a customer'),
  status: z.enum(projectStatusValues).optional().default('lead'),
});

/**
 * Inline project create for the "+ Add new project" pickers. Returns the
 * created project instead of redirecting. A project needs a customer (NOT
 * NULL FK), so the quick-add drawer collects one — financials default to 0
 * and are set later on the project page.
 */
export async function createProjectInlineAction(input: {
  name: string;
  customerId: string;
  status?: string;
}): Promise<InlineCreateProjectResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { ok: false, error: 'You do not have permission to create projects.' };
  }
  const parsed = inlineProjectSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { ok: false, errors: fe, error: fe.customerId?.[0] ?? fe.name?.[0] };
  }
  const companyId = await getActiveCompanyId();
  try {
    const project = await createProject(companyId, {
      customerId: parsed.data.customerId,
      name: parsed.data.name,
      status: parsed.data.status,
      jobsiteAddressLine1: null,
      jobsiteAddressLine2: null,
      jobsiteCity: null,
      jobsiteState: null,
      jobsitePostalCode: null,
      projectManagerId: null,
      estimatorId: null,
      startDate: null,
      targetCompletionDate: null,
      actualCompletionDate: null,
      contractValue: '0',
      originalContractValue: '0',
      totalChangeOrders: '0',
      currentBudget: '0',
      notes: null,
    });
    revalidatePath('/projects');
    return {
      ok: true,
      project: {
        id: project.id,
        name: project.name,
        customerId: parsed.data.customerId,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Failed to create project: ${message}` };
  }
}

/**
 * Set a project's single budget (current_budget) — the per-job cost baseline
 * that drives % complete and WIP earned revenue when there's no detailed
 * line-item estimate. Powers the fast "Set job budgets" editor.
 */
export async function setProjectBudgetAction(input: {
  projectId: string;
  budget: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { ok: false, error: 'No permission to edit projects.' };
  }
  const id = z.string().uuid().safeParse(input.projectId);
  if (!id.success) return { ok: false, error: 'Invalid project.' };
  const n = Number(input.budget);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Enter a budget of 0 or more.' };
  }
  const companyId = await getActiveCompanyId();
  const updated = await updateProject(companyId, id.data, {
    currentBudget: n.toFixed(2),
  });
  if (!updated) return { ok: false, error: 'Project not found.' };
  revalidatePath('/reports/wip');
  revalidatePath('/reports/wip/budgets');
  revalidatePath('/reports/profit-loss');
  revalidatePath(`/projects/${id.data}`);
  return { ok: true };
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

  // The form's "Base contract value" field IS the base — it maps to
  // originalContractValue. Editing it must keep the invariant:
  //
  //   contractValue (revised) = originalContractValue + sum(approved COs)
  //
  // We set originalContractValue from the form, then call the recompute
  // helper to derive contractValue from it + the actual approved-CO sum.
  // The old behavior — updating only contractValue and "preserving"
  // originalContractValue as an audit trail — silently broke the invariant
  // every time the operator corrected a contract value, which is why
  // Customer Summary stillBillable on West Wind and MoH didn't tie out.
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
      // Set originalContractValue from the form. contractValue gets
      // overwritten below by the recompute; setting it here too keeps the
      // row internally consistent if recompute fails for any reason.
      originalContractValue: data.contractValue,
      contractValue: data.contractValue,
      currentBudget: data.estimatedBudget,
      notes: emptyToNull(data.notes ?? null),
    });
    if (!updated) {
      return { formError: 'Project not found in the active company.' };
    }
    // Re-derive contractValue = originalContractValue + sum(approved COs).
    // Quiet no-op in demo mode (recompute returns null when the DB isn't
    // configured); demo path uses the mock-store update above directly.
    await recomputeProjectContractTotalsFromCOs(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save project: ${message}` };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${id}`);
  // Customer Summary aggregates contract value — refresh it too so the
  // operator sees the corrected stillBillable on the next page load.
  revalidatePath('/reports/customer-summary');
  revalidatePath('/dashboard');
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

// ---------------------------------------------------------------------------
// Self-heal: recompute project.totalChangeOrders + project.contractValue
// from the authoritative list of approved COs. Useful when the running
// balance has drifted from an earlier bug.
// ---------------------------------------------------------------------------

export type RecomputeTotalsState = {
  formError?: string;
  ok?: boolean;
  result?: {
    originalContractValue: number;
    approvedCOTotal: number;
    newContractValue: number;
  };
};

export async function recomputeProjectTotalsAction(
  projectId: string,
  _prev: RecomputeTotalsState,
  _formData: FormData,
): Promise<RecomputeTotalsState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { formError: 'You do not have permission to recompute project totals.' };
  }
  const idCheck = z.string().uuid('Missing project id').safeParse(projectId);
  if (!idCheck.success) return { formError: 'Invalid project id.' };

  try {
    const result = await recomputeProjectContractTotalsFromCOs(projectId);
    if (!result) {
      return { formError: 'Project not found, or recompute not available in demo mode.' };
    }
    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/projects');
    revalidatePath('/dashboard');
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Recompute failed: ${message}` };
  }
}
