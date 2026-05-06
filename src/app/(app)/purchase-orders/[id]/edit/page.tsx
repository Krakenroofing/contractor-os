import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { PurchaseOrderHeaderEditForm } from '@/modules/purchase-orders/components/purchase-order-header-edit-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getPurchaseOrder } from '@/lib/data/purchase-orders';

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

  // Only drafts are editable. An issued PO is committed cost — receipts
  // and job costing are reading from it. Edits past draft must go through
  // the status panel (void) or by superseding the PO entirely.
  if (po.status !== 'draft') {
    redirect(`/purchase-orders/${id}` as never);
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
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
          Edit purchase order
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Header-only edit. Vendor, project, line items, and totals aren&apos;t
          editable here — re-create the PO from scratch if you need to change
          them. PO number is locked.
        </p>
      </header>

      <PurchaseOrderHeaderEditForm
        id={po.id}
        initial={{
          issueDate: po.issueDate ?? '',
          expectedDeliveryDate: po.expectedDeliveryDate ?? '',
          shipToAddressLine1: po.shipToAddressLine1 ?? '',
          shipToCity: po.shipToCity ?? '',
          shipToState: po.shipToState ?? '',
          shipToPostalCode: po.shipToPostalCode ?? '',
          notes: po.notes ?? '',
        }}
      />
    </div>
  );
}
