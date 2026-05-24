import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
} from '@/lib/data/purchase-orders';
import { getVendor } from '@/lib/data/vendors';
import { RecordPoReceiptForm } from '@/modules/purchase-orders/components/record-po-receipt-form';

export const dynamic = 'force-dynamic';

export default async function ReceivePurchaseOrderPage({
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

  // Receiving is only meaningful between issued and closed. Drafts must be
  // issued first; closed/void POs are off-limits. (Receiving past 100% on
  // an already-`received` PO is allowed — see decision in [[project-inventory-phase-6-1]].)
  if (po.status === 'draft') {
    redirect(`/purchase-orders/${id}` as never);
  }
  if (po.status === 'closed' || po.status === 'void') {
    redirect(`/purchase-orders/${id}` as never);
  }

  const lines = await getPurchaseOrderLines(po.id);
  const vendor = await getVendor(companyId, po.vendorId);

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/purchase-orders', label: 'Purchase orders' },
          { href: `/purchase-orders/${po.id}`, label: po.number },
          { label: 'Receive' },
        ]}
      />

      <Link href={{ pathname: `/purchase-orders/${po.id}` }}>
        <Button variant="outline" size="sm">
          ← Back to PO
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Record shipment received
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          PO <span className="font-mono">{po.number}</span>
          {vendor ? <> from <span className="font-medium">{vendor.name}</span></> : null}.
          Enter how much of each line actually arrived in this shipment. Leave a
          row blank if nothing came in for it. The PO status will update
          automatically based on running totals.
        </p>
      </header>

      <RecordPoReceiptForm
        poId={po.id}
        poNumber={po.number}
        lines={lines.map((l) => ({
          id: l.id,
          description: l.description,
          unit: l.unit,
          quantityOrdered: Number(l.quantityOrdered),
          quantityReceivedAlready: Number(l.quantityReceived),
        }))}
      />
    </div>
  );
}
