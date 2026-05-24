import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInventoryItem } from '@/lib/data/inventory-items';
import {
  getOnHandForItem,
  listMovementsForItem,
} from '@/lib/data/inventory-movements';
import { getDb, isDatabaseConfigured } from '@/db';
import { poReceiptLines, poReceipts, purchaseOrders } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { ArchiveProductForm } from '@/modules/inventory/components/archive-product-form';
import { AdjustOnHandForm } from '@/modules/inventory/components/adjust-on-hand-form';

export const dynamic = 'force-dynamic';

type MovementSource = {
  poId: string;
  poNumber: string;
};

async function loadPoSourcesForReceiptLines(
  receiptLineIds: string[],
): Promise<Map<string, MovementSource>> {
  const map = new Map<string, MovementSource>();
  if (receiptLineIds.length === 0 || !isDatabaseConfigured()) return map;
  const db = getDb()!;
  const rows = await db
    .select({
      receiptLineId: poReceiptLines.id,
      poId: purchaseOrders.id,
      poNumber: purchaseOrders.number,
    })
    .from(poReceiptLines)
    .innerJoin(poReceipts, eq(poReceipts.id, poReceiptLines.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poReceipts.purchaseOrderId))
    .where(inArray(poReceiptLines.id, receiptLineIds));
  for (const r of rows) {
    map.set(r.receiptLineId, { poId: r.poId, poNumber: r.poNumber });
  }
  return map;
}

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  received: 'Received',
  issued_to_job: 'Issued to job',
  adjustment: 'Adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowEdit = canCreate(role, 'inventory');
  const item = await getInventoryItem(companyId, id);
  if (!item) notFound();

  const onHand = await getOnHandForItem(companyId, item.id);
  const movements = await listMovementsForItem(companyId, item.id, 200);
  const receiptLineIds = movements
    .map((m) => m.poReceiptLineId)
    .filter((v): v is string => v !== null);
  const poSources = await loadPoSourcesForReceiptLines(receiptLineIds);

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/inventory', label: 'Inventory' },
          { label: item.name },
        ]}
      />

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{item.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            {item.category && <span>{item.category}</span>}
            {item.archivedAt && <Badge tone="slate">Archived</Badge>}
            {!item.archivedAt &&
              (item.isTaxable ? (
                <Badge tone="blue">Taxable</Badge>
              ) : (
                <Badge tone="slate">Exempt</Badge>
              ))}
          </div>
        </div>
        {allowEdit && (
          <div className="flex items-center gap-2">
            <Link href={`/inventory/${item.id}/edit`}>
              <Button variant="outline">Edit</Button>
            </Link>
            <ArchiveProductForm
              id={item.id}
              archived={item.archivedAt !== null}
            />
          </div>
        )}
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>On hand</CardTitle>
            {allowEdit && (
              <AdjustOnHandForm
                itemId={item.id}
                unit={item.unit}
                onHand={onHand}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3">
            <span
              className={`text-3xl font-semibold tabular-nums ${
                onHand < 0
                  ? 'text-red-700'
                  : onHand === 0
                    ? 'text-slate-400'
                    : 'text-slate-900'
              }`}
            >
              {onHand.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
            <span className="text-sm text-slate-500">
              {item.unit ?? 'units'}
            </span>
          </div>
          {onHand < 0 && (
            <p className="mt-2 text-xs text-red-700">
              Negative on-hand means you&apos;ve recorded more outbound than
              inbound — usually a missing receipt or a stale adjustment. Worth
              reviewing the history below.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Pair label="SKU" value={item.sku ?? '—'} />
            <Pair label="Unit" value={item.unit ?? '—'} />
            <Pair label="Default cost" value={formatMoney(item.defaultCost)} />
            <Pair
              label="QuickBooks expense account"
              value={item.qbGlAccountText ?? '—'}
            />
          </dl>
          {item.notes && (
            <div className="mt-4 border-t pt-4 text-sm">
              <div className="text-slate-500 mb-1">Notes</div>
              <div className="text-slate-800 whitespace-pre-wrap">{item.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movement history ({movements.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {movements.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No movements yet — nothing received, issued, or adjusted for this
              product. Receiving a PO line that references this product will
              create a movement automatically.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => {
                  const qty = Number(m.quantity);
                  const poSource = m.poReceiptLineId
                    ? poSources.get(m.poReceiptLineId)
                    : undefined;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="tabular-nums text-slate-900">
                        {m.occurredAt.toISOString().slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {MOVEMENT_TYPE_LABEL[m.movementType] ?? m.movementType}
                        {m.reversalOfId && (
                          <Badge tone="slate" className="ml-2">
                            Reversal
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          qty < 0 ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {qty > 0 ? '+' : ''}
                        {qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {poSource ? (
                          <Link
                            href={`/purchase-orders/${poSource.poId}`}
                            className="text-blue-600 hover:underline font-mono text-xs"
                          >
                            {poSource.poNumber}
                          </Link>
                        ) : m.movementType === 'adjustment' ? (
                          'Manual'
                        ) : m.poReceiptLineId === null && m.reversalOfId ? (
                          'Reversed receipt'
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs">
                        {m.notes ?? '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}
