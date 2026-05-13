import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { getCustomer } from '@/lib/data/customers';
import { getLandedCost } from '@/lib/data/landed-costs';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import {
  LandedCostForm,
  type LandedCostFormInitial,
} from '@/modules/landed-cost/components/landed-cost-form';
import { SEED_TARIFF_LIBRARY } from '@/modules/landed-cost/data';
import { getDb, isDatabaseConfigured } from '@/db';
import { purchaseOrders as poTable } from '@/db/schema';

export const dynamic = 'force-dynamic';

export default async function EditLandedCostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) redirect('/landed-cost');
  const companyId = await getActiveCompanyId();

  const lc = await getLandedCost(companyId, id);
  if (!lc) notFound();

  // Same context the calculator page loads — needed for the dropdowns.
  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        label: `${p.number} — ${p.name}${customer ? ` (${customer.name})` : ''}`,
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

  // Recover the linked PO id (back-reference lives on the PO row).
  let linkedPOId: string | null = null;
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select({ id: poTable.id })
      .from(poTable)
      .where(eq(poTable.landedCostEntryId, lc.id))
      .limit(1);
    linkedPOId = rows[0]?.id ?? null;
  }

  const initial: LandedCostFormInitial = {
    id: lc.id,
    name: lc.name,
    projectId: lc.projectId ?? '',
    vendorId: lc.vendorId,
    purchaseOrderId: linkedPOId,
    carrier: lc.carrier ?? 'Tropical',
    itemDescription: lc.itemDescription,
    tariffCode: lc.tariffCode,
    quantity: lc.quantity,
    unitCost: lc.unitCost,
    flDelivery: lc.flDelivery,
    crating: lc.crating,
    freightCost: lc.freightCost,
    insurance: lc.insurance,
    dutyPercent: lc.dutyPercent,
    vatPercent: lc.vatPercent,
    envLevyPercent: lc.envLevyPercent,
    excisePercent: lc.excisePercent,
    brokerage: lc.brokerage,
    portFees: lc.portFees,
    localDelivery: lc.localDelivery,
    notes: lc.notes,
  };

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/landed-cost', label: 'Landed Cost / Shipping' },
          { href: `/landed-cost/${lc.id}`, label: lc.name },
          { label: 'Edit' },
        ]}
      />

      <Link href={`/landed-cost/${lc.id}`}>
        <Button variant="outline" size="sm">
          ← Back to Landed Cost
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Edit {lc.name}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Update vendor cost, freight, duty/VAT rates, or local fees. The
          total and per-unit landed cost recompute live as you type.
        </p>
      </header>

      <LandedCostForm
        projects={projects}
        vendors={vendors}
        purchaseOrders={purchaseOrders}
        tariffs={SEED_TARIFF_LIBRARY}
        defaultName={lc.name}
        initial={initial}
      />
    </div>
  );
}
