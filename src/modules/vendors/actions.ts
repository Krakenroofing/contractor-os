'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  createVendor,
  softDeleteVendor,
  updateVendor,
} from '@/lib/data/vendors';
import { vendorFormSchema } from './schema';

export type CreateVendorState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type UpdateVendorState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type ArchiveVendorState = {
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function readForm(formData: FormData) {
  return {
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
  };
}

export async function createVendorAction(
  _prev: CreateVendorState,
  formData: FormData,
): Promise<CreateVendorState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) {
    return { formError: 'You do not have permission to create vendors.' };
  }

  const parsed = vendorFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const vendor = await createVendor(companyId, {
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

const idSchema = z.string().uuid('Missing or invalid id');

export async function updateVendorAction(
  _prev: UpdateVendorState,
  formData: FormData,
): Promise<UpdateVendorState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) {
    return { formError: 'You do not have permission to edit vendors.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing vendor id on the form.' };
  }
  const id = idResult.data;

  const parsed = vendorFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  try {
    const updated = await updateVendor(companyId, id, {
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
      isSubcontractor: data.vendorType === 'subcontractor',
      notes: emptyToNull(data.notes ?? null),
    });
    if (!updated) {
      return { formError: 'Vendor not found in the active company.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save vendor: ${message}` };
  }

  revalidatePath('/vendors');
  revalidatePath(`/vendors/${id}`);
  redirect(`/vendors/${id}`);
}

export async function archiveVendorAction(
  _prev: ArchiveVendorState,
  formData: FormData,
): Promise<ArchiveVendorState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) {
    return { formError: 'You do not have permission to archive vendors.' };
  }

  const idResult = idSchema.safeParse(formData.get('id'));
  if (!idResult.success) {
    return { formError: 'Missing vendor id.' };
  }
  const id = idResult.data;
  const companyId = await getActiveCompanyId();

  try {
    const removed = await softDeleteVendor(companyId, id);
    if (!removed) {
      return { formError: 'Vendor not found.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to archive vendor: ${message}` };
  }

  revalidatePath('/vendors');
  redirect('/vendors');
}
