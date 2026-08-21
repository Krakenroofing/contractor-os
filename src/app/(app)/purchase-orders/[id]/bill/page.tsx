import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
} from '@/lib/data/purchase-orders';
import { listBillsForPo, sumBilledByPoLine } from '@/lib/data/po-bills';
import { getVendor } from '@/lib/data/vendors';
import {
  PoBillForm,
  type PoBillLine,
} from '@/modules/purchase-orders/components/po-bill-form';

export const dynamic = 'force-dynamic';

// PO → bill: partial-shipment billing. Pick the lines the vendor's invoice
// covers, type THEIR invoice number, get a draft bill to review and post.
export default async function PoBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) redirect('/purchase-orders');
  const company = await getActiveCompany();
  const { id } = await params;

  const po = await getPurchaseOrder(company.id, id);
  if (!po) notFound();

  const [poLines, billed, bills, vendor] = await Promise.all([
    getPurchaseOrderLines(po.id),
    sumBilledByPoLine(company.id, po.id),
    listBillsForPo(company.id, po.id),
    getVendor(company.id, po.vendorId),
  ]);

  const lines: PoBillLine[] = poLines.map((l) => ({
    id: l.id,
    description: l.description,
    unit: l.unit,
    quantityOrdered: Number(l.quantityOrdered),
    unitCost: Number(l.unitCost),
    lineTotal: Number(l.lineTotal),
    billedAmount: billed.get(l.id) ?? 0,
  }));

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/purchase-orders', label: 'Purchase Orders' },
          { href: `/purchase-orders/${po.id}`, label: po.number },
          { label: 'Create bill' },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">
            Bill {po.number}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {vendor?.name ?? 'Vendor'} — pick the lines this vendor invoice
            covers (partial shipments bill only what arrived). The draft bill
            opens for category/VAT review; Post puts it on Accounts Payable,
            where it stays outstanding until matched to the bank payment.
          </p>
        </header>
        <Link href={{ pathname: `/purchase-orders/${po.id}` }}>
          <Button variant="outline" size="sm">
            ← Back to PO
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-6">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">
              This purchase order has no line items to bill.
            </p>
          ) : (
            <PoBillForm poId={po.id} lines={lines} />
          )}
        </CardContent>
      </Card>

      {bills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bills already created from this PO</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Vendor inv #</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{b.receiptDate}</td>
                    <td className="px-4 py-2">
                      <Link
                        href={{ pathname: `/banking/receipts/${b.id}` }}
                        className="text-blue-700 hover:underline"
                      >
                        {b.vendorInvoiceNumber ?? '(no number)'}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{b.status}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMoney(Number(b.total))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
