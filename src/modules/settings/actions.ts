'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyId } from '@/lib/active-company';
import { updateCompany } from '@/lib/data/companies';
import { companySettingsFormSchema } from './schema';

export type CompanySettingsState = {
  errors?: Record<string, string[]>;
  formError?: string;
  ok?: boolean;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function updateCompanySettingsAction(
  _prev: CompanySettingsState,
  formData: FormData,
): Promise<CompanySettingsState> {
  const parsed = companySettingsFormSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    website: formData.get('website') ?? '',
    licenseNumber: formData.get('licenseNumber') ?? '',
    addressLine1: formData.get('addressLine1') ?? '',
    city: formData.get('city') ?? '',
    state: formData.get('state') ?? '',
    postalCode: formData.get('postalCode') ?? '',
    defaultCurrency: formData.get('defaultCurrency') ?? 'USD',
    defaultMarkupPercent: formData.get('defaultMarkupPercent') ?? '0',
    taxRatePercent: formData.get('taxRatePercent') ?? '0',
    vatRatePercent: formData.get('vatRatePercent') ?? '0',
    proposalValidityDays: formData.get('proposalValidityDays') ?? '30',
    standardPaymentTerms: formData.get('standardPaymentTerms') ?? '',
    standardWarrantyLanguage: formData.get('standardWarrantyLanguage') ?? '',
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  const updated = await updateCompany(companyId, {
    name: data.name,
    email: emptyToNull(data.email ?? null),
    phone: emptyToNull(data.phone ?? null),
    website: emptyToNull(data.website ?? null),
    licenseNumber: emptyToNull(data.licenseNumber ?? null),
    addressLine1: emptyToNull(data.addressLine1 ?? null),
    addressLine2: null,
    city: emptyToNull(data.city ?? null),
    state: emptyToNull(data.state ?? null),
    postalCode: emptyToNull(data.postalCode ?? null),
    defaultCurrency: data.defaultCurrency.trim().toUpperCase(),
    defaultMarkupPercent: Number(data.defaultMarkupPercent).toFixed(3),
    taxRatePercent: Number(data.taxRatePercent).toFixed(3),
    vatRatePercent: Number(data.vatRatePercent).toFixed(3),
    proposalValidityDays: Number(data.proposalValidityDays),
    standardPaymentTerms: emptyToNull(data.standardPaymentTerms ?? null),
    standardWarrantyLanguage: emptyToNull(data.standardWarrantyLanguage ?? null),
  });

  if (!updated) {
    return { formError: 'Company not found' };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
