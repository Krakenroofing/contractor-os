'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createEmployee,
  softDeleteEmployee,
  updateEmployee,
} from '@/lib/data/employees';
import { employeeFormSchema } from './schema';

export type CreateEmployeeState = {
  errors?: Record<string, string[]>;
  formError?: string;
};
export type UpdateEmployeeState = CreateEmployeeState;
export type ArchiveEmployeeState = { formError?: string };

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function readForm(formData: FormData) {
  return {
    firstName: formData.get('firstName') ?? '',
    lastName: formData.get('lastName') ?? '',
    nibNumber: formData.get('nibNumber') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    employmentType: formData.get('employmentType') ?? 'hourly',
    payRate: formData.get('payRate') ?? '0',
    hireDate: formData.get('hireDate') ?? '',
    terminationDate: formData.get('terminationDate') ?? '',
    // HTML checkboxes only submit when checked — treat missing as false.
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
    notes: formData.get('notes') ?? '',
  };
}

export async function createEmployeeAction(
  _prev: CreateEmployeeState,
  formData: FormData,
): Promise<CreateEmployeeState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'employees')) {
    return { formError: 'You do not have permission to create employees.' };
  }

  const parsed = employeeFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const employee = await createEmployee(companyId, {
      firstName: data.firstName,
      lastName: data.lastName,
      nibNumber: emptyToNull(data.nibNumber ?? null),
      email: emptyToNull(data.email ?? null),
      phone: emptyToNull(data.phone ?? null),
      employmentType: data.employmentType,
      payRate: data.payRate,
      hireDate: emptyToNull(data.hireDate ?? null),
      terminationDate: emptyToNull(data.terminationDate ?? null),
      active: data.active,
      notes: emptyToNull(data.notes ?? null),
    });
    createdId = employee.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create employee: ${message}` };
  }

  revalidatePath('/employees');
  redirect(`/employees/${createdId}`);
}

const idSchema = z.string().uuid('Missing or invalid id');

export async function updateEmployeeAction(
  _prev: UpdateEmployeeState,
  formData: FormData,
): Promise<UpdateEmployeeState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'employees')) {
    return { formError: 'You do not have permission to edit employees.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing employee id on the form.' };
  }
  const id = idResult.data;

  const parsed = employeeFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  try {
    const updated = await updateEmployee(companyId, id, {
      firstName: data.firstName,
      lastName: data.lastName,
      nibNumber: emptyToNull(data.nibNumber ?? null),
      email: emptyToNull(data.email ?? null),
      phone: emptyToNull(data.phone ?? null),
      employmentType: data.employmentType,
      payRate: data.payRate,
      hireDate: emptyToNull(data.hireDate ?? null),
      terminationDate: emptyToNull(data.terminationDate ?? null),
      active: data.active,
      notes: emptyToNull(data.notes ?? null),
    });
    if (!updated) {
      return { formError: 'Employee not found in the active company.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save employee: ${message}` };
  }

  revalidatePath('/employees');
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}`);
}

export async function archiveEmployeeAction(
  _prev: ArchiveEmployeeState,
  formData: FormData,
): Promise<ArchiveEmployeeState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'employees')) {
    return { formError: 'You do not have permission to archive employees.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing employee id.' };
  }
  const id = idResult.data;
  const companyId = await getActiveCompanyId();

  try {
    const removed = await softDeleteEmployee(companyId, id);
    if (!removed) {
      return { formError: 'Employee not found.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to archive employee: ${message}` };
  }

  revalidatePath('/employees');
  redirect('/employees');
}
