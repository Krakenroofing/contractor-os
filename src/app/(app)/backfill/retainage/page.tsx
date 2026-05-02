import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import { listInvoices } from '@/lib/data/invoices';
import { listRetainageReleases } from '@/lib/data/retainage-releases';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { RetainageMiniForm } from '@/modules/backfill/components/retainage-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillRetainagePage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const [invoices, releases] = await Promise.all([
    listInvoices(companyId),
    listRetainageReleases(companyId),
  ]);

  // Show only invoices that still have retainage to release.
  const options = invoices
    .filter((i) => i.status !== 'void')
    .filter(
      (i) =>
        subtract(parseMoney(i.retainageAmount), parseMoney(i.retainageReleased)) >
        0,
    )
    .map((i) => ({
      id: i.id,
      label: `${i.number} · ${formatMoney(
        subtract(
          parseMoney(i.retainageAmount),
          parseMoney(i.retainageReleased),
        ),
      )} held`,
    }));

  const recent = releases.filter(
    (r) => new Date(`${r.releaseDate}T00:00:00Z`).getTime() >= CUTOFF.getTime(),
  );

  return (
    <StepShell
      step="retainage"
      prevHref="/backfill/purchase-orders"
      nextHref="/backfill/review"
    >
      <Card>
        <CardHeader>
          <CardTitle>Record a retainage release</CardTitle>
        </CardHeader>
        <CardContent>
          <RetainageMiniForm invoices={options} />
          <p className="text-xs text-slate-500 mt-3">
            Releases reduce the held retainage on the linked invoice. Over-releases
            are blocked — you can only release up to the remaining held balance.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Releases entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/retainage' }} className="text-sm text-slate-500 hover:underline">
              Full retainage tracker →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No releases backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((r) => {
                const inv = invoices.find((i) => i.id === r.invoiceId);
                return (
                  <li
                    key={r.id}
                    className="py-2 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        <span className="font-mono text-xs text-slate-500 mr-2">
                          {r.releaseNumber || 'RTN'}
                        </span>
                        {formatMoney(r.amount)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.releaseDate}
                        {inv ? ` · invoice ${inv.number}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="green">released</Badge>
                      {inv && (
                        <Link
                          href={{ pathname: `/invoices/${inv.id}` }}
                          className="text-xs text-slate-600 hover:underline"
                        >
                          Open invoice →
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
