'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { createMockVendor } from '@/lib/mock-store';
import { vendorFormSchema } from './schema';

export type CreateVendorState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createVendorAction(
  _prev: CreateVendorState,
  formData: FormData,
): Promise<CreateVendorState> {
  const parsed = vendorFormSchema.safeParse({
    name: formData.get('name'),
    vendorType: formData.get('vendorType') ?? 'supplier',
    primaryContactName: formData.get('primaryContactName') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    addressLine1: formData.get('addressLine1') ?? '',
    city: formData.get('city') ?? '',
    state: formData.get('state') ?? '',
    postalCode: formData.get('postalCode') ?? '',
    defaultTerms: formData.get('defaultTerms') ?? '',
    notes: formData.get('notes') ?? '',
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const vendor = createMockVendor(companyId, {
      name: data.name,
      primaryContactName: emptyToNull(data.primaryContactName ?? null),
      email: emptyToNull(data.email ?? null),
      phone: emptyToNull(data.phone ?? null),
      addressLine1: emptyToNull(data.addressLine1 ?? null),
      addressLine2: null,
      city: emptyToNull(data.city ?? null),
      state: emptyToNull(data.state ?? null),
      postalCode: emptyToNull(data.postalCode ?? null),
      defaultTerms: emptyToNull(data.defaultTerms ?? null),
      taxIdLast4: null,
      isSubcontractor: data.vendorType === 'subcontractor',
      w9OnFile: false,
      notes: emptyToNull(data.notes ?? null),
    });
    createdId = vendor.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create vendor: ${message}` };
  }

  revalidatePath('/vendors');
  redirect(`/vendors/${createdId}`);
}
