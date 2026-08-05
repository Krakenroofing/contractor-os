import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  buildRetainageRowsForCompany,
  listRecentRetainageReleases,
  summarizeRetainage,
} from '@/modules/retainage/lib/retainage';
import { RetainageListClient } from '@/modules/retainage/components/retainage-list-client';

export const dynamic = 'force-dynamic';

export default async function RetainagePage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  if (!canView(role, 'retainage')) redirect('/dashboard');
  const allowCreate = canCreate(role, 'retainage');
  const asOf = new Date();

  const rows = await buildRetainageRowsForCompany(companyId, asOf);
  const summary = summarizeRetainage(rows);
  const recent = await listRecentRetainageReleases(companyId, 5);

  // Find an invoice with held balance > 0 to suggest as the default release target.
  const firstReleasable = rows.find((r) => r.retainageBalance > 0);

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — retainage is derived live from invoices with a retainage % and the
          retainage_releases table. Releasing retainage updates the invoice's released
          total and the project financial summary.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Retainage Tracking</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {summary.invoiceCount}{' '}
            {summary.invoiceCount === 1 ? 'invoice' : 'invoices'} with retainage activity
            {summary.overdueCount > 0
              ? ` · ${summary.overdueCount} overdue release${summary.overdueCount === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        {allowCreate && firstReleasable && (
          <Link href={`/retainage/${firstReleasable.invoiceId}/release`}>
            <Button>Release Retainage</Button>
          </Link>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Total held" value={formatMoney(summary.totalHeld)} highlight />
        <KPI
          label="Total released"
          value={formatMoney(summary.totalReleased)}
          valueClassName="text-emerald-700"
        />
        <KPI
          label="Outstanding"
          value={formatMoney(summary.outstanding)}
          valueClassName={summary.outstanding > 0 ? 'text-amber-700' : 'text-slate-900'}
        />
        <KPI
          label="Overdue"
          value={formatMoney(summary.overdue)}
          valueClassName={summary.overdue > 0 ? 'text-red-600' : 'text-slate-900'}
        />
      </div>

      <RetainageListClient rows={rows} allowCreate={allowCreate} />

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent retainage releases</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="divide-y divide-slate-200">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-xs text-slate-500">
                      {r.releaseNumber || 'Release'}
                    </span>
                    <span className="text-slate-700">{r.releaseDate}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-700">{r.customerName}</span>
                    <span className="text-slate-400">·</span>
                    <Link
                      href={`/invoices/${r.invoiceId}`}
                      className="font-mono text-xs text-slate-700 hover:underline"
                    >
                      {r.invoiceNumber}
                    </Link>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">{r.projectName}</span>
                    {r.notes && (
                      <Badge tone="slate" className="ml-1">
                        note
                      </Badge>
                    )}
                  </div>
                  <span className="font-medium tabular-nums text-emerald-700">
                    {formatMoney(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  highlight,
  valueClassName,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <Card className={highlight ? 'border-slate-300' : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
