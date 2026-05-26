'use server';

// Admin-side server actions for managing crew assignments per project
// per day. Lives under /projects/[id] — only owner / PM roles can create
// or delete.
//
// Permission model: we reuse the `projects:create` action on the project
// resource. Anyone who can edit a project can also assign crew to it.
// Field users (who only view their own assignments via /field/jobs)
// can't reach these actions because the create gate would fail.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createAssignment,
  deleteAssignment,
} from '@/lib/data/project-assignments';

export type AssignmentState = {
  ok?: boolean;
  formError?: string;
  errors?: Record<string, string[]>;
};

const createSchema = z.object({
  projectId: z.string().uuid('Missing project'),
  employeeId: z.string().uuid('Pick an employee'),
  assignedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  roleLabel: z.string().max(100).optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export async function createAssignmentAction(
  _prev: AssignmentState,
  formData: FormData,
): Promise<AssignmentState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { formError: 'You don\'t have permission to assign crew.' };
  }

  const parsed = createSchema.safeParse({
    projectId: formData.get('projectId') ?? '',
    employeeId: formData.get('employeeId') ?? '',
    assignedDate: formData.get('assignedDate') ?? '',
    roleLabel: formData.get('roleLabel') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const user = await getCurrentUser();

  try {
    await createAssignment({
      companyId,
      projectId: parsed.data.projectId,
      employeeId: parsed.data.employeeId,
      assignedDate: parsed.data.assignedDate,
      roleLabel: parsed.data.roleLabel?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      createdBy: user?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to assign: ${message}` };
  }

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}

export async function deleteAssignmentAction(
  _prev: AssignmentState,
  formData: FormData,
): Promise<AssignmentState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { formError: 'You don\'t have permission to remove assignments.' };
  }

  const id = formData.get('id');
  const projectId = formData.get('projectId');
  if (typeof id !== 'string' || id === '') {
    return { formError: 'Missing assignment id.' };
  }

  const companyId = await getActiveCompanyId();
  await deleteAssignment(companyId, id);

  if (typeof projectId === 'string' && projectId) {
    revalidatePath(`/projects/${projectId}`);
  }
  return { ok: true };
}
