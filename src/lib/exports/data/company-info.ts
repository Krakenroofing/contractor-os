// Shared helper: convert the active-company record into the CompanyInfo
// shape every document payload uses. Includes logo lookup → base64 data URL
// so PDF renderers stay self-contained (no runtime network fetch).

import 'server-only';
import type { getActiveCompany } from '@/lib/active-company';
import { getCompanyLogoDataUrl } from '@/lib/storage/company-logos';
import type { CompanyInfo } from '@/lib/exports/types';

export async function buildCompanyInfo(
  company: Awaited<ReturnType<typeof getActiveCompany>>,
): Promise<CompanyInfo> {
  const logoDataUrl = company.logoUrl
    ? await getCompanyLogoDataUrl(company.logoUrl)
    : null;
  return {
    name: company.name,
    email: company.email,
    phone: company.phone,
    website: company.website,
    licenseNumber: company.licenseNumber,
    addressLine1: company.addressLine1,
    city: company.city,
    state: company.state,
    postalCode: company.postalCode,
    tinNumber: company.tinNumber,
    defaultCurrency: company.defaultCurrency,
    logoDataUrl,
  };
}
