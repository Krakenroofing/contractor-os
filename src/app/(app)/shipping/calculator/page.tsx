import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import { LandedCostForm } from '@/modules/landed-cost/components/landed-cost-form';
import { SEED_TARIFF_LIBRARY } from '@/modules/landed-cost/data';

export const dynamic = 'force-dynamic';

export default async function ShippingCalculatorPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) redirect('/landed-cost');

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
  const vendors = (await listVendors(companyId)).map((v) => ({
    id: v.id,
    label: v.name,
  }));
  const purchaseOrders = (await listPurchaseOrders(companyId)).map((po) => ({
    id: po.id,
    number: po.number,
    projectId: po.projectId,
    vendorId: po.vendorId,
  }));

  const defaultName = `Landed cost — ${new Date().toISOString().slice(0, 10)}`;

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/landed-cost', label: 'Landed Cost / Shipping' },
          { label: 'New estimate' },
        ]}
      />

      <Link href="/landed-cost">
        <Button variant="outline" size="sm">
          ← Back to Landed Cost
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Landed Cost Calculator
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Build up the all-in delivered cost for a project import. Save the estimate
          and link it to a purchase order so the PO and project job-costing reflect
          the true landed cost.
        </p>
      </header>

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">⚠ Reminder:</span> Final landed cost depends
        on broker classification, customs assessment, exchange rate, freight
        invoices, and current Bahamas Customs rules. Use this estimate for planning;
        verify against actual broker entry summary before billing.
      </div>

      <LandedCostForm
        projects={projects}
        vendors={vendors}
        purchaseOrders={purchaseOrders}
        tariffs={SEED_TARIFF_LIBRARY}
        defaultName={defaultName}
      />
    </div>
  );
}
