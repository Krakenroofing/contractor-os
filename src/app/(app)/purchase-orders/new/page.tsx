import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PurchaseOrderForm } from '@/modules/purchase-orders/components/purchase-order-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listInventoryItems } from '@/lib/data/inventory-items';
import { listLandedCosts } from '@/lib/data/landed-costs';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';

export const dynamic = 'force-dynamic';

async function nextPONumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await listPurchaseOrders(companyId);
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
  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        label: `${p.name}${customer ? ` (${customer.name})` : ''}`,
      };
    }),
  );
  const vendors = (await listVendors(companyId)).map((v) => ({ id: v.id, label: v.name }));
  const costCodes = (await listCostCodes(companyId)).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
  }));
  const landedCosts = (await listLandedCosts(companyId)).map((l) => ({
    id: l.id,
    projectId: l.projectId,
    label: `${l.name} · ${formatMoney(l.totalLandedCost)} total`,
  }));
  const products = (await listInventoryItems(companyId)).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    sku: p.sku,
    unit: p.unit,
    defaultCost: Number(p.defaultCost),
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
        products={products}
        defaultNumber={await nextPONumber(companyId)}
      />
    </div>
  );
}
