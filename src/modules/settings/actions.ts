'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyId } from '@/lib/active-company';
import { getCompany, updateCompany } from '@/lib/data/companies';
import { requireAuth } from '@/lib/auth';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  ALLOWED_LOGO_MIME,
  CompanyLogoStorageNotConfiguredError,
  MAX_LOGO_BYTES,
  deleteCompanyLogoBlob,
  uploadCompanyLogo,
} from '@/lib/storage/company-logos';
import {
  seedContractorCategoriesForCompany,
  type SeedContractorCategoriesResult,
} from '@/lib/seeds/contractor-accounting-categories';
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
    // Phase 1 banking / TIN
    tinNumber: formData.get('tinNumber') ?? '',
    bankName: formData.get('bankName') ?? '',
    bankBranch: formData.get('bankBranch') ?? '',
    bankAccountName: formData.get('bankAccountName') ?? '',
    bankAccountNumber: formData.get('bankAccountNumber') ?? '',
    bankAddress: formData.get('bankAddress') ?? '',
    paymentNotes: formData.get('paymentNotes') ?? '',
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
    // Phase 1 banking / TIN
    tinNumber: emptyToNull(data.tinNumber ?? null),
    bankName: emptyToNull(data.bankName ?? null),
    bankBranch: emptyToNull(data.bankBranch ?? null),
    bankAccountName: emptyToNull(data.bankAccountName ?? null),
    bankAccountNumber: emptyToNull(data.bankAccountNumber ?? null),
    bankAddress: emptyToNull(data.bankAddress ?? null),
    paymentNotes: emptyToNull(data.paymentNotes ?? null),
  });

  if (!updated) {
    return { formError: 'Company not found' };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Logo upload (separate form — file inputs don't mix cleanly with the
// main settings text fields). Replaces any existing logo: best-effort blob
// cleanup, then upload, then set logoUrl to the new bucket key.
// ---------------------------------------------------------------------------

export type CompanyLogoActionState = {
  formError?: string;
  ok?: boolean;
};

export async function uploadCompanyLogoAction(
  _prev: CompanyLogoActionState,
  formData: FormData,
): Promise<CompanyLogoActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { formError: 'You do not have permission to change company branding.' };
  }
  const companyId = await getActiveCompanyId();
  const company = await getCompany(companyId);
  if (!company) return { formError: 'Active company not found.' };

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { formError: 'Pick a logo image to upload.' };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return {
      formError: `Logo is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is ${Math.round(
        MAX_LOGO_BYTES / 1024 / 1024,
      )} MB.`,
    };
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_LOGO_MIME.has(mime)) {
    return {
      formError: `Unsupported image type: ${file.type || 'unknown'}. Use PNG, JPG, WebP, GIF, or SVG.`,
    };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { storagePath } = await uploadCompanyLogo({
      companyId,
      bytes,
      mimeType: mime,
      originalFileName: file.name,
    });

    // Update company.logoUrl to the new bucket key.
    const oldPath = company.logoUrl;
    const updated = await updateCompany(companyId, { logoUrl: storagePath });
    if (!updated) return { formError: 'Failed to update company.' };

    // Best-effort delete of the previous blob — don't fail the upload if
    // cleanup hiccups; an orphaned blob just costs storage.
    if (oldPath && oldPath !== storagePath) {
      try {
        await deleteCompanyLogoBlob(oldPath);
      } catch {
        /* swallow */
      }
    }
  } catch (err) {
    if (err instanceof CompanyLogoStorageNotConfiguredError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Logo upload failed: ${message}` };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function removeCompanyLogoAction(
  _prev: CompanyLogoActionState,
  _formData: FormData,
): Promise<CompanyLogoActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { formError: 'You do not have permission to change company branding.' };
  }
  const companyId = await getActiveCompanyId();
  const company = await getCompany(companyId);
  if (!company) return { formError: 'Active company not found.' };
  const oldPath = company.logoUrl;

  await updateCompany(companyId, { logoUrl: null });
  if (oldPath) {
    try {
      await deleteCompanyLogoBlob(oldPath);
    } catch {
      /* swallow */
    }
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

// ===== Phase 1 operational accounting: seed contractor categories =====

export type SeedContractorCategoriesState = {
  formError?: string;
  result?: SeedContractorCategoriesResult;
};

export async function seedContractorCategoriesAction(
  _prev: SeedContractorCategoriesState,
  _formData: FormData,
): Promise<SeedContractorCategoriesState> {
  await requireAuth();
  const role = await getActiveRole();
  // Reuse the 'settings' resource for permissions — anyone who can edit
  // company settings can install the category structure.
  if (!canCreate(role, 'settings')) {
    return { formError: 'You do not have permission to seed accounting categories.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const result = await seedContractorCategoriesForCompany(companyId);
    revalidatePath('/settings');
    // Also invalidate any page that renders the category picker so the
    // new options show up immediately.
    revalidatePath('/banking/receipts');
    revalidatePath('/banking/rules');
    return { result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to seed categories: ${message}` };
  }
}
