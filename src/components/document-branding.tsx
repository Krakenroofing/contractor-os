import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';

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

  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Prepared by</p>
          <p className="text-lg font-semibold text-slate-900">{company.name}</p>
          {address && <p className="text-xs text-slate-600">{address}</p>}
          <div className="text-xs text-slate-600 flex flex-wrap gap-x-3">
            {company.email && <span>{company.email}</span>}
            {company.phone && <span>{company.phone}</span>}
            {company.website && <span>{company.website}</span>}
          </div>
          {company.licenseNumber && (
            <p className="text-xs text-slate-500 pt-1">
              License #: {company.licenseNumber}
            </p>
          )}
        </div>
        <div className="h-14 w-14 rounded-md bg-slate-900 text-white flex items-center justify-center text-sm font-semibold shrink-0">
          {initials}
        </div>
      </CardContent>
    </Card>
  );
}
