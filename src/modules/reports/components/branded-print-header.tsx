// Server component — branded header that renders ONLY when the page is being
// printed (or when a user explicitly opts into the print preview). Pulls the
// active company's name, address, license, contact info, and uses initials as
// a logo placeholder. Renders the report title large at the top.
//
// On screen this whole block is hidden via Tailwind's `print:` variant so it
// doesn't take up real estate; on paper / PDF it's the first thing readers
// see.

import { getActiveCompany } from '@/lib/active-company';
import { describeRange, REPORT_LABEL, type ReportFilters, type ReportType } from '@/modules/reports/lib/filters';

export async function BrandedPrintHeader({
  type,
  filters,
}: {
  type: ReportType;
  filters: ReportFilters;
}) {
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

  const generated = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="hidden print:block mb-6 pb-4 border-b border-slate-300">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-0.5 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">
            Prepared by
          </p>
          <p className="text-base font-semibold text-slate-900">{company.name}</p>
          {address && <p className="text-xs text-slate-600">{address}</p>}
          <div className="text-xs text-slate-600 flex flex-wrap gap-x-3">
            {company.email && <span>{company.email}</span>}
            {company.phone && <span>{company.phone}</span>}
            {company.website && <span>{company.website}</span>}
          </div>
          {company.licenseNumber && (
            <p className="text-[10px] text-slate-500 pt-0.5">
              License #: {company.licenseNumber}
            </p>
          )}
        </div>
        <div className="h-12 w-12 rounded-md bg-slate-900 text-white flex items-center justify-center text-sm font-semibold shrink-0">
          {initials}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">
          Report
        </p>
        <h1 className="text-xl font-semibold text-slate-900 leading-tight">
          {REPORT_LABEL[type]}
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Period: {describeRange(filters)} · Generated {generated}
        </p>
      </div>
    </div>
  );
}
