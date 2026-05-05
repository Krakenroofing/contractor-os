import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { getProject } from '@/lib/data/projects';
import { getVendor, listVendors } from '@/lib/data/vendors';
import { PurchaseOrdersListClient } from '@/modules/purchase-orders/components/purchase-orders-list-client';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'purchase_orders');
  const pos = await Promise.all(
    (await listPurchaseOrders(companyId)).map(async (p) => {
      const vendor = await getVendor(companyId, p.vendorId);
      const project = await getProject(companyId, p.projectId);
      return {
        id: p.id,
        number: p.number,
        vendorId: p.vendorId,
        vendorName: vendor?.name ?? '—',
        projectName: project?.name ?? '—',
        status: p.status,
        issueDate: p.issueDate,
        expectedDeliveryDate: p.expectedDeliveryDate,
        subtotal: p.subtotal,
        taxAmount: p.taxAmount,
        shipping: p.shipping,
        total: p.total,
      };
    }),
  );

  const vendors = (await listVendors(companyId)).map((v) => ({ id: v.id, label: v.name }));

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — purchase orders loaded from the in-memory mock store.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Purchase Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {pos.length} {pos.length === 1 ? 'purchase order' : 'purchase orders'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/purchase-orders/new">
            <Button>New Purchase Order</Button>
          </Link>
        )}
      </header>

      <PurchaseOrdersListClient pos={pos} vendors={vendors} />
    </div>
  );
}
