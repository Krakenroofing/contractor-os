import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { createSignedLogoUrl } from '@/lib/storage/company-logos';

export async function DocumentBranding() {
  const company = await getActiveCompany();
  const address = [
    company.addressLine1,
    company.city,
    company.state,
    company.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
  const initials = company.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // company.logoUrl stores a Supabase Storage bucket key (path within
  // `company-logos`). We mint a fresh signed URL per render; falls back to
  // an initials chip when no logo is set or storage isn't configured.
  const logoSignedUrl = company.logoUrl
    ? await createSignedLogoUrl(company.logoUrl)
    : null;

  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Prepared by</p>
          {/* Logo wordmarks usually include the company name, so suppress the
              text name when a logo is present to avoid duplication. The
              initials-chip fallback path keeps the name visible. */}
          {!logoSignedUrl && (
            <p className="text-lg font-semibold text-slate-900">{company.name}</p>
          )}
          {address && <p className="text-xs text-slate-600">{address}</p>}
          <div className="text-xs text-slate-600 flex flex-wrap gap-x-3">
            {company.email && <span>{company.email}</span>}
            {company.phone && <span>{company.phone}</span>}
            {company.website && <span>{company.website}</span>}
          </div>
          <div className="text-xs text-slate-500 pt-1 flex flex-wrap gap-x-3">
            {company.licenseNumber && (
              <span>License #: {company.licenseNumber}</span>
            )}
            {company.tinNumber && <span>TIN: {company.tinNumber}</span>}
          </div>
        </div>
        {logoSignedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSignedUrl}
            alt={`${company.name} logo`}
            className="h-20 max-w-[180px] object-contain shrink-0"
          />
        ) : (
          <div className="h-14 w-14 rounded-md bg-slate-900 text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {initials}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
