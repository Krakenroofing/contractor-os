'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { createCustomer } from '@/lib/data/customers';
import { customerFormSchema } from './schema';

export type CreateCustomerState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

export async function createCustomerAction(
  _prev: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const parsed = customerFormSchema.safeParse({
    name: formData.get('name'),
    customerType: formData.get('customerType') ?? 'residential',
    primaryContactName: formData.get('primaryContactName') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    billingAddressLine1: formData.get('billingAddressLine1') ?? '',
    billingCity: formData.get('billingCity') ?? '',
    billingState: formData.get('billingState') ?? '',
    billingPostalCode: formData.get('billingPostalCode') ?? '',
    notes: formData.get('notes') ?? '',
  });

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
