import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  getPurchaseOrderLines,
  listPurchaseOrdersForVendor,
} from '@/lib/data/purchase-orders';
import { listVendors } from '@/lib/data/vendors';
import { VendorsListClient } from '@/modules/vendors/components/vendors-list-client';

export const dynamic = 'force-dynamic';

async function vendorTotals(vendorId: string) {
  const pos = (await listPurchaseOrdersForVendor(vendorId)).filter((p) => p.status !== 'void');
  let committed = 0;
  let openCount = 0;
  for (const po of pos) {
    committed += Number(po.total);
    if (po.status !== 'received' && po.status !== 'closed') openCount += 1;
    void getPurchaseOrderLines; // silence unused warn — kept for future receipts
  }
  return { committed, openCount };
}

export default async function VendorsPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'vendors');
  const vendors = await Promise.all(
    (await listVendors(companyId)).map(async (v) => {
      const totals = await vendorTotals(v.id);
      return {
        id: v.id,
        name: v.name,
        isSubcontractor: v.isSubcontractor,
        primaryContactName: v.primaryContactName,
        email: v.email,
        phone: v.phone,
        defaultTerms: v.defaultTerms,
        openPOCount: totals.openCount,
        committed: totals.committed,
      };
    }),
  );

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — vendors loaded from the in-memory mock store. Open POs and committed
          spend are rolled up live.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Vendors</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {vendors.length} {vendors.length === 1 ? 'vendor' : 'vendors'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/vendors/new">
            <Button>New Vendor</Button>
          </Link>
        )}
      </header>

      <VendorsListClient vendors={vendors} />
    </div>
  );
}
