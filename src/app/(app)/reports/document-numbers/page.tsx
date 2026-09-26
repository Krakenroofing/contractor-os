import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { auditDocumentSequences } from '@/lib/data/document-numbers';

export const dynamic = 'force-dynamic';

// Document number audit (roadmap Priority 1): every number the system has
// issued since its counter started must exist as a document (live or void)
// or be explained by a logged draft deletion. Anything else is flagged.
export default async function DocumentNumbersReportPage() {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const audits = await auditDocumentSequences(company.id);

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Document number audit
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          <span className="font-medium text-slate-900">{company.name}</span> —
          invoice and credit-memo numbers are assigned by the system, in order,
          and can&apos;t be edited. Voided documents keep their number. This
          report accounts for every number since each counter started.
          Historical invoices entered under their original (QuickBooks) number
          are listed separately.
        </p>
      </header>

      {audits.length === 0 && (
        <p className="text-sm text-slate-500">No numbering counters yet.</p>
      )}

      {audits.map((a) => {
        const complete = a.unexplained.length === 0;
        return (
          <Card key={a.docType}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                {a.label}
                {complete ? (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-normal text-emerald-700">
                    ✓ Complete — no gaps
                  </span>
                ) : (
                  <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-normal text-red-700">
                    ⚠ {a.unexplained.length} unexplained gap
                    {a.unexplained.length === 1 ? '' : 's'}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-slate-600">
                System numbering started at{' '}
                <span className="font-mono">{a.startValue}</span>
                {a.nextValue > a.startValue ? (
                  <>
                    {' '}— issued through{' '}
                    <span className="font-mono">{a.nextValue - 1}</span>:{' '}
                    {a.issued} on file ({a.voided} void)
                    {a.deletedDrafts.length > 0
                      ? `, ${a.deletedDrafts.length} deleted draft${a.deletedDrafts.length === 1 ? '' : 's'}`
                      : ''}
                    .
                  </>
                ) : (
                  <> — nothing issued under the new numbering yet.</>
                )}{' '}
                Next: <span className="font-mono">{a.nextValue}</span>.
              </p>
              {a.unexplained.length > 0 && (
                <div>
                  <p className="font-medium text-red-700">Missing numbers</p>
                  <p className="font-mono text-xs text-red-700">
                    {a.unexplained.join(', ')}
                  </p>
                </div>
              )}
              {a.deletedDrafts.length > 0 && (
                <div>
                  <p className="font-medium text-slate-700">Deleted drafts</p>
                  <ul className="text-xs text-slate-600">
                    {a.deletedDrafts.map((d) => (
                      <li key={d.number}>
                        <span className="font-mono">{d.number}</span> — deleted{' '}
                        {new Date(d.at).toISOString().slice(0, 10)}
                        {d.by ? ` by ${d.by}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {a.external.length > 0 && (
                <div>
                  <p className="font-medium text-slate-700">
                    Historical numbers entered by hand
                  </p>
                  <ul className="text-xs text-slate-600">
                    {a.external.map((d, i) => (
                      <li key={`${d.number}-${i}`}>
                        <span className="font-mono">{d.number}</span> —{' '}
                        {new Date(d.at).toISOString().slice(0, 10)}
                        {d.by ? ` by ${d.by}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
