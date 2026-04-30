import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';

export async function CompanyStandardTerms({
  showProposalValidity = false,
}: {
  showProposalValidity?: boolean;
}) {
  const company = await getActiveCompany();

  const tax = Number(company.taxRatePercent);
  const vat = Number(company.vatRatePercent);
  const hasTaxOrVat = tax > 0 || vat > 0;
  const hasContent =
    company.standardPaymentTerms ||
    company.standardWarrantyLanguage ||
    hasTaxOrVat ||
    company.licenseNumber ||
    showProposalValidity;

  if (!hasContent) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Standard terms — {company.name}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-5">
        {company.standardPaymentTerms && (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              Payment terms
            </p>
            <div className="whitespace-pre-wrap text-slate-800 leading-relaxed">
              {company.standardPaymentTerms}
            </div>
          </div>
        )}

        {company.standardWarrantyLanguage && (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              Warranty
            </p>
            <div className="whitespace-pre-wrap text-slate-800 leading-relaxed">
              {company.standardWarrantyLanguage}
            </div>
          </div>
        )}

        {(hasTaxOrVat || showProposalValidity || company.licenseNumber) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-slate-100 text-xs">
            {tax > 0 && (
              <Stat label="Sales tax" value={`${tax.toFixed(2)}%`} />
            )}
            {vat > 0 && (
              <Stat label="VAT" value={`${vat.toFixed(2)}%`} />
            )}
            {showProposalValidity && (
              <Stat
                label="Proposal validity"
                value={`${company.proposalValidityDays} days`}
              />
            )}
            {company.licenseNumber && (
              <Stat label="License" value={company.licenseNumber} />
            )}
            <Stat label="Currency" value={company.defaultCurrency} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-900 font-medium tabular-nums">{value}</p>
    </div>
  );
}
