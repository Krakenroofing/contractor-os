'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
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
    // Vendor defaults
    defaultCostCodeId: formData.get('defaultCostCodeId') ?? '',
    defaultCostType: formData.get('defaultCostType') ?? '',
    defaultAccountingAccountId:
      formData.get('defaultAccountingAccountId') ?? '',
  };
}

export async function createVendorAction(
  _prev: CreateVendorState,
  formData: FormData,
): Promise<CreateVendorState> {
  await requireAuth();
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
      defaultCostCodeId: data.defaultCostCodeId,
      defaultCostType: data.defaultCostType,
      defaultAccountingAccountId: data.defaultAccountingAccountId,
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
  await requireAuth();
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
      defaultCostCodeId: data.defaultCostCodeId,
      defaultCostType: data.defaultCostType,
      defaultAccountingAccountId: data.defaultAccountingAccountId,
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

// Phase 1 vendor defaults — invoked by the inline "Save as default for
// <vendor>" link on the Receipt form. Writes only the three defaults; leaves
// every other vendor field alone.
const saveDefaultsSchema = z.object({
  vendorId: idSchema,
  defaultCostCodeId: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  defaultCostType: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  defaultAccountingAccountId: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

export async function saveVendorDefaultsAction(input: {
  vendorId: string;
  defaultCostCodeId: string | null;
  defaultCostType: string | null;
  defaultAccountingAccountId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) {
    return { ok: false, error: 'No permission to edit vendors.' };
  }
  const parsed = saveDefaultsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const companyId = await getActiveCompanyId();
  const updated = await updateVendor(companyId, parsed.data.vendorId, {
    defaultCostCodeId: parsed.data.defaultCostCodeId,
    defaultCostType: parsed.data.defaultCostType,
    defaultAccountingAccountId: parsed.data.defaultAccountingAccountId,
  });
  if (!updated) return { ok: false, error: 'Vendor not found.' };
  revalidatePath(`/vendors/${parsed.data.vendorId}`);
  revalidatePath('/banking/receipts');
  return { ok: true };
}

export async function archiveVendorAction(
  _prev: ArchiveVendorState,
  formData: FormData,
): Promise<ArchiveVendorState> {
  await requireAuth();
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
