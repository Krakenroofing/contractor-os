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
import { listReceipts } from '@/lib/data/receipts';
import { sumReceiptSettlements } from '@/lib/data/transaction-matches';
import { sumAppliedCreditsByReceipt } from '@/lib/data/vendor-credits';
import { listVendors } from '@/lib/data/vendors';
import { formatMoney } from '@/lib/money';
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

  // Open bills per vendor, on the same math as the AP report: a posted bank
  // bill is outstanding for total − vendor credits − bank money matched to
  // it. What's owed is the headline number on this list, not PO commitments.
  const [postedBills, receiptPaid] = await Promise.all([
    listReceipts(companyId, { status: 'posted', limit: 5000 }),
    sumReceiptSettlements(companyId),
  ]);
  const bankBills = postedBills.filter((r) => r.paymentSourceType === 'bank');
  const creditByBill = await sumAppliedCreditsByReceipt(
    companyId,
    bankBills.map((b) => b.id),
  );
  const openBills = new Map<string, { count: number; amount: number }>();
  for (const b of bankBills) {
    const outstanding =
      Number(b.total) - (creditByBill.get(b.id) ?? 0) - (receiptPaid.get(b.id) ?? 0);
    if (outstanding <= 0.005) continue;
    const key = b.vendorId ?? '';
    if (!key) continue;
    const cur = openBills.get(key) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount = Math.round((cur.amount + outstanding) * 100) / 100;
    openBills.set(key, cur);
  }

  const vendors = await Promise.all(
    (await listVendors(companyId)).map(async (v) => {
      const totals = await vendorTotals(v.id);
      const bills = openBills.get(v.id) ?? { count: 0, amount: 0 };
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
        openBillCount: bills.count,
        outstanding: bills.amount,
      };
    }),
  );
  const totalOutstanding = vendors.reduce((s, v) => s + v.outstanding, 0);

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
            {vendors.length} {vendors.length === 1 ? 'vendor' : 'vendors'} ·{' '}
            <span className="text-amber-700 font-medium">
              {formatMoney(totalOutstanding)} outstanding
            </span>{' '}
            on open bills
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
