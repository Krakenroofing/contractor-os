import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { PurchaseOrderEditForm } from '@/modules/purchase-orders/components/purchase-order-edit-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
} from '@/lib/data/purchase-orders';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import { listCustomers } from '@/lib/data/customers';
import { listCostCodes } from '@/lib/data/cost-codes';

export const dynamic = 'force-dynamic';

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) redirect('/purchase-orders');

  const companyId = await getActiveCompanyId();
  const po = await getPurchaseOrder(companyId, id);
  if (!po) notFound();

  // Fully received / closed / void POs are history — everything else is
  // editable (committed cost recomputes live from the lines; received
  // quantities and receipt history survive edits by line id).
  if (
    po.status === 'received' ||
    po.status === 'closed' ||
    po.status === 'void'
  ) {
    redirect(`/purchase-orders/${id}` as never);
  }

  const [lines, projects, vendors, customers, costCodes] = await Promise.all([
    getPurchaseOrderLines(po.id),
    listProjects(companyId),
    listVendors(companyId),
    listCustomers(companyId),
    listCostCodes(companyId),
  ]);

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/purchase-orders', label: 'Purchase orders' },
          { href: `/purchase-orders/${po.id}`, label: po.number },
          { label: 'Edit' },
        ]}
      />

      <Link href={{ pathname: `/purchase-orders/${po.id}` }}>
        <Button variant="outline" size="sm">
          ← Back to PO
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Edit {po.number}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Vendor, project, dates, and line items are all editable. Each line
          can be tagged to its own job — one PO can split a purchase across
          jobs. The PO number is changed from the PO page (Rename).
        </p>
      </header>

      <PurchaseOrderEditForm
        poId={po.id}
        status={po.status}
        initial={{
          projectId: po.projectId,
          vendorId: po.vendorId,
          issueDate: po.issueDate ?? '',
          expectedDeliveryDate: po.expectedDeliveryDate ?? '',
          taxAmount: Number(po.taxAmount).toString(),
          shipping: Number(po.shipping).toString(),
          notes: po.notes ?? '',
          lines: lines.map((l) => ({
            id: l.id,
            costCodeId: l.costCodeId,
            inventoryItemId: l.inventoryItemId ?? '',
            projectId: l.projectId ?? '',
            description: l.description,
            unit: l.unit ?? '',
            quantity: Number(l.quantityOrdered).toString(),
            unitCost: Number(l.unitCost).toString(),
            quantityReceived: Number(l.quantityReceived),
          })),
        }}
        projects={projects.map((p) => ({ id: p.id, label: p.name }))}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        costCodes={costCodes.map((c) => ({
          id: c.id,
          code: c.code,
          description: c.description,
          defaultCost: c.defaultCost === null ? null : Number(c.defaultCost),
        }))}
      />
    </div>
  );
}
