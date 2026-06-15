'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createCustomer,
  softDeleteCustomer,
  updateCustomer,
} from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { customerFormSchema, customerTypeValues } from './schema';

export type CreateCustomerState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

// Returned to the inline "+ Add new customer" pickers.
export type InlineCustomer = { id: string; name: string };

export type InlineCreateCustomerResult =
  | { ok: true; customer: InlineCustomer }
  | { ok: false; error?: string; errors?: Record<string, string[]> };

const inlineCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(200),
  customerType: z.enum(customerTypeValues).optional().default('residential'),
});

export type UpdateCustomerState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type ArchiveCustomerState = {
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function readForm(formData: FormData) {
  return {
    name: formData.get('name'),
    customerType: formData.get('customerType') ?? 'residential',
    primaryContactName: formData.get('primaryContactName') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    billingAddressLine1: formData.get('billingAddressLine1') ?? '',
    billingCity: formData.get('billingCity') ?? '',
    billingState: formData.get('billingState') ?? '',
    billingPostalCode: formData.get('billingPostalCode') ?? '',
    tinNumber: formData.get('tinNumber') ?? '',
    notes: formData.get('notes') ?? '',
  };
}

export async function createCustomerAction(
  _prev: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'customers')) {
    return { formError: 'You do not have permission to create customers.' };
  }

  const parsed = customerFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const customer = await createCustomer(companyId, {
      name: data.name,
      customerType: data.customerType,
      primaryContactName: emptyToNull(data.primaryContactName ?? null),
      email: emptyToNull(data.email ?? null),
      phone: emptyToNull(data.phone ?? null),
      billingAddressLine1: emptyToNull(data.billingAddressLine1 ?? null),
      billingAddressLine2: null,
      billingCity: emptyToNull(data.billingCity ?? null),
      billingState: emptyToNull(data.billingState ?? null),
      billingPostalCode: emptyToNull(data.billingPostalCode ?? null),
      tinNumber: emptyToNull(data.tinNumber ?? null),
      notes: emptyToNull(data.notes ?? null),
    });
    createdId = customer.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create customer: ${message}` };
  }

  revalidatePath('/customers');
  redirect(`/customers/${createdId}`);
}

/**
 * Inline customer create for the "+ Add new customer" pickers. Returns the
 * created customer instead of redirecting, so the open form can inject and
 * select it in place. Minimal (name + type); fill the rest in later.
 */
export async function createCustomerInlineAction(input: {
  name: string;
  customerType?: string;
}): Promise<InlineCreateCustomerResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'customers')) {
    return { ok: false, error: 'You do not have permission to create customers.' };
  }
  const parsed = inlineCustomerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const companyId = await getActiveCompanyId();
  try {
    const customer = await createCustomer(companyId, {
      name: parsed.data.name,
      customerType: parsed.data.customerType,
      primaryContactName: null,
      email: null,
      phone: null,
      billingAddressLine1: null,
      billingAddressLine2: null,
      billingCity: null,
      billingState: null,
      billingPostalCode: null,
      tinNumber: null,
      notes: null,
    });
    revalidatePath('/customers');
    revalidatePath('/projects/new');
    return { ok: true, customer: { id: customer.id, name: customer.name } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Failed to create customer: ${message}` };
  }
}

const idSchema = z.string().uuid('Missing or invalid id');

export async function updateCustomerAction(
  _prev: UpdateCustomerState,
  formData: FormData,
): Promise<UpdateCustomerState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'customers')) {
    return { formError: 'You do not have permission to edit customers.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing customer id on the form.' };
  }
  const id = idResult.data;

  const parsed = customerFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  try {
    const updated = await updateCustomer(companyId, id, {
      name: data.name,
      customerType: data.customerType,
      primaryContactName: emptyToNull(data.primaryContactName ?? null),
      email: emptyToNull(data.email ?? null),
      phone: emptyToNull(data.phone ?? null),
      billingAddressLine1: emptyToNull(data.billingAddressLine1 ?? null),
      billingAddressLine2: null,
      billingCity: emptyToNull(data.billingCity ?? null),
      billingState: emptyToNull(data.billingState ?? null),
      billingPostalCode: emptyToNull(data.billingPostalCode ?? null),
      tinNumber: emptyToNull(data.tinNumber ?? null),
      notes: emptyToNull(data.notes ?? null),
    });
    if (!updated) {
      return { formError: 'Customer not found in the active company.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save customer: ${message}` };
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}`);
}

export async function archiveCustomerAction(
  _prev: ArchiveCustomerState,
  formData: FormData,
): Promise<ArchiveCustomerState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'customers')) {
    return { formError: 'You do not have permission to archive customers.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing customer id.' };
  }
  const id = idResult.data;
  const companyId = await getActiveCompanyId();

  // Block archive when projects still reference this customer — getCustomer
  // filters out archived customers, so their project detail pages would 404.
  const linkedProjects = (await listProjects(companyId)).filter(
    (p) => p.customerId === id,
  );
  if (linkedProjects.length > 0) {
    return {
      formError: `Can't archive: ${linkedProjects.length} project${
        linkedProjects.length === 1 ? '' : 's'
      } still belong to this customer. Reassign or remove them first.`,
    };
  }

  try {
    const removed = await softDeleteCustomer(companyId, id);
    if (!removed) {
      return { formError: 'Customer not found.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to archive customer: ${message}` };
  }

  revalidatePath('/customers');
  redirect('/customers');
}
