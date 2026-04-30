import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PurchaseOrderForm } from '@/modules/purchase-orders/components/purchase-order-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  getMockCustomer,
  listMockCostCodes,
  listMockLandedCosts,
  listMockProjects,
  listMockPurchaseOrders,
  listMockVendors,
} from '@/lib/mock-store';

export const dynamic = 'force-dynamic';

function nextPONumber(companyId: string): string {
  const year = new Date().getFullYear();
  const existing = listMockPurchaseOrders(companyId);
  const matching = existing
    .map((p) => p.number)
    .filter((n) => n.startsWith(`PO-${year}-`))
    .map((n) => Number(n.slice(`PO-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `PO-${year}-${String(next).padStart(3, '0')}`;
}

export default async function NewPurchaseOrderPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) redirect('/purchase-orders');
  const companyId = await getActiveCompanyId();
  const projects = listMockProjects(companyId).map((p) => {
    const customer = getMockCustomer(companyId, p.customerId);
    return {
      id: p.id,
      label: `${p.number} — ${p.name}${customer ? ` (${customer.name})` : ''}`,
    };
  });
  const vendors = listMockVendors(companyId).map((v) => ({ id: v.id, label: v.name }));
  const costCodes = listMockCostCodes(companyId).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
  }));
  const landedCosts = listMockLandedCosts(companyId).map((l) => ({
    id: l.id,
    projectId: l.projectId,
    label: `${l.name} · ${formatMoney(l.totalLandedCost)} total`,
  }));

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Link href="/purchase-orders">
        <Button variant="outline" size="sm">
          ← Back to Purchase Orders
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New purchase order</h1>
        <p className="text-sm text-slate-500 mt-1">
          Order materials or subcontract from a vendor against a specific project and cost
          code. Subtotal, tax + freight, and total update live.
        </p>
      </header>

      <PurchaseOrderForm
        projects={projects}
        vendors={vendors}
        costCodes={costCodes}
        landedCosts={landedCosts}
        defaultNumber={nextPONumber(companyId)}
      />
    </div>
  );
}
