import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { PurchaseOrderMiniForm } from '@/modules/backfill/components/purchase-order-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillPurchaseOrdersPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const [projects, vendors, purchaseOrders] = await Promise.all([
    listProjects(companyId),
    listVendors(companyId),
    listPurchaseOrders(companyId),
  ]);
  const recent = purchaseOrders.filter(
    (po) =>
      (po.issueDate &&
        new Date(`${po.issueDate}T00:00:00Z`).getTime() >= CUTOFF.getTime()) ||
      po.createdAt.getTime() >= CUTOFF.getTime(),
  );

  return (
    <StepShell
      step="purchase-orders"
      prevHref="/backfill/payments"
      nextHref="/backfill/retainage"
    >
      <Card>
        <CardHeader>
          <CardTitle>Add a purchase order</CardTitle>
        </CardHeader>
        <CardContent>
          {vendors.length === 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 mb-4">
              No vendors on file yet — add one at{' '}
              <Link
                href={{ pathname: '/vendors/new' }}
                className="underline font-medium"
              >
                /vendors/new
              </Link>{' '}
              before recording a PO.
            </div>
          )}
          <PurchaseOrderMiniForm
            projects={projects.map((p) => ({
              id: p.id,
              label: p.name,
            }))}
            vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
          />
          <p className="text-xs text-slate-500 mt-3">
            For landed-cost imports use{' '}
            <Link
              href={{ pathname: '/shipping/calculator' }}
              className="underline"
            >
              /shipping/calculator
            </Link>{' '}
            — the calculator carries the full duty / VAT breakdown.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Purchase orders entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/purchase-orders' }} className="text-sm text-slate-500 hover:underline">
              Full PO list →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No POs backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((po) => (
                <li
                  key={po.id}
                  className="py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      <span className="font-mono text-xs text-slate-500 mr-2">
                        {po.number}
                      </span>
                      {formatMoney(po.total)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {po.issueDate ?? '—'}
                      {po.expectedDeliveryDate
                        ? ` · expected ${po.expectedDeliveryDate}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{po.status.replace('_', ' ')}</Badge>
                    <Link
                      href={{ pathname: `/purchase-orders/${po.id}` }}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
