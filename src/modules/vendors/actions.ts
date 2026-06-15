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
import { vendorFormSchema, vendorTypeValues } from './schema';

export type CreateVendorState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

// Shape returned to the inline "+ Add new vendor" pickers. Carries the
// defaults each picker may prefill (VAT rate, GL account, cost code/type) so a
// just-created vendor behaves like an existing one without a page reload.
export type InlineVendor = {
  id: string;
  name: string;
  vatRatePercent: number | null;
  defaultAccountingAccountId: string | null;
  defaultCostCodeId: string | null;
  defaultCostType: string | null;
};

export type InlineCreateVendorResult =
  | { ok: true; vendor: InlineVendor }
  | { ok: false; error?: string; errors?: Record<string, string[]> };

const inlineVendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required').max(200),
  vendorType: z.enum(vendorTypeValues).optional().default('supplier'),
});

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
    vatRatePercent: formData.get('vatRatePercent') ?? '',
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
      vatRatePercent: data.vatRatePercent,
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

/**
 * Inline vendor create for the "+ Add new vendor" pickers. Unlike
 * createVendorAction it does NOT redirect — it returns the created vendor so
 * the open form can inject and select it in place. Minimal by design (name +
 * type); the rest of the vendor record is filled in later on /vendors.
 */
export async function createVendorInlineAction(input: {
  name: string;
  vendorType?: string;
}): Promise<InlineCreateVendorResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) {
    return { ok: false, error: 'You do not have permission to create vendors.' };
  }
  const parsed = inlineVendorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const companyId = await getActiveCompanyId();
  try {
    const vendor = await createVendor(companyId, {
      name: parsed.data.name,
      primaryContactName: null,
      email: null,
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      defaultTerms: null,
      taxIdLast4: null,
      isSubcontractor: parsed.data.vendorType === 'subcontractor',
      w9OnFile: false,
      notes: null,
      vatRatePercent: null,
      defaultCostCodeId: null,
      defaultCostType: null,
      defaultAccountingAccountId: null,
    });
    // Refresh the surfaces that render vendor pickers so a full reload also
    // shows the new vendor (the picker injects it client-side immediately).
    revalidatePath('/vendors');
    revalidatePath('/purchase-orders/new');
    revalidatePath('/banking/receipts');
    return {
      ok: true,
      vendor: {
        id: vendor.id,
        name: vendor.name,
        vatRatePercent:
          vendor.vatRatePercent != null ? Number(vendor.vatRatePercent) : null,
        defaultAccountingAccountId: vendor.defaultAccountingAccountId ?? null,
        defaultCostCodeId: vendor.defaultCostCodeId ?? null,
        defaultCostType: vendor.defaultCostType ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Failed to create vendor: ${message}` };
  }
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
      vatRatePercent: data.vatRatePercent,
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
