// Server component — branded header that renders ONLY when the page is being
// printed (or when a user explicitly opts into the print preview). Pulls the
// active company's logo, name, address, license, and contact info. Renders the
// report title prominently below the brand block for client-facing PDFs.
//
// On screen this whole block is hidden via Tailwind's `print:` variant so it
// doesn't take up real estate; on paper / PDF it's the first thing readers
// see.

import { getActiveCompany } from '@/lib/active-company';
import { createSignedLogoUrl } from '@/lib/storage/company-logos';
import {
  describeRange,
  REPORT_LABEL,
  type ReportFilters,
  type ReportType,
} from '@/modules/reports/lib/filters';

export async function BrandedPrintHeader({
  type,
  filters,
}: {
  type: ReportType;
  filters: ReportFilters;
}) {
  const company = await getActiveCompany();

  // `companies.logo_url` stores the Supabase Storage bucket key, not a
  // fetchable URL. Mint a short-lived signed URL so the <img> tag below
  // (and the browser's Save-as-PDF renderer) can actually load the file.
  const logoSrc = company.logoUrl
    ? await createSignedLogoUrl(company.logoUrl)
    : null;

  const addressLines = [
    company.addressLine1,
    company.addressLine2,
    [company.city, company.state, company.postalCode]
      .filter(Boolean)
      .join(', '),
  ].filter((line): line is string => Boolean(line && line.trim()));

  const initials = company.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const generated = new Date().toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <div className="hidden print:block mb-6">
      <div className="flex items-start justify-between gap-8 pb-5 border-b-2 border-slate-900">
        <div className="flex items-start gap-4 min-w-0">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt={`${company.name} logo`}
              className="h-20 max-w-[180px] object-contain shrink-0"
            />
          ) : (
            <div className="h-20 w-20 rounded-md bg-slate-900 text-white flex items-center justify-center text-xl font-semibold shrink-0">
              {initials}
            </div>
          )}
          <div className="space-y-0.5 min-w-0">
            {/* Company name is intentionally suppressed when a logo is present
                — most uploaded logos already include the company wordmark, so
                printing it again next to the logo reads as a duplicate. The
                initials-chip fallback keeps the name visible when no logo. */}
            {!logoSrc && (
              <p className="text-lg font-bold text-slate-900 leading-tight">
                {company.name}
              </p>
            )}
            {addressLines.map((line) => (
              <p key={line} className="text-xs text-slate-700">
                {line}
              </p>
            ))}
            <div className="text-xs text-slate-700 flex flex-wrap gap-x-3 pt-0.5">
              {company.email && <span>{company.email}</span>}
              {company.phone && <span>{company.phone}</span>}
              {company.website && <span>{company.website}</span>}
            </div>
            {(company.licenseNumber || company.tinNumber) && (
              <p className="text-[10px] text-slate-500 pt-0.5">
                {company.licenseNumber && <>License #: {company.licenseNumber}</>}
                {company.licenseNumber && company.tinNumber && ' · '}
                {company.tinNumber && <>TIN: {company.tinNumber}</>}
              </p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">
            Report
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 leading-tight">
            {REPORT_LABEL[type]}
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Period: {describeRange(filters)}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Generated {generated}
          </p>
        </div>
      </div>
    </div>
  );
}
