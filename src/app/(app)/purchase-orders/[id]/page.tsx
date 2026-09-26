import Link from 'next/link';
import { DocumentFlowCard } from '@/modules/document-flow/components/document-flow-card';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/back-button';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import { CompanyStandardTerms } from '@/components/company-standard-terms';
import { DocumentBranding } from '@/components/document-branding';
import { DocumentDownloadButtons } from '@/components/document-download-buttons';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canApproveReceipt, canCreate } from '@/lib/permissions';
import { getUserNamesByIds } from '@/lib/data/users';
import { PoApprovalPanel } from '@/modules/purchase-orders/components/po-approval-panel';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { listInventoryItems } from '@/lib/data/inventory-items';
import { getLandedCost } from '@/lib/data/landed-costs';
import { getPurchaseOrder, getPurchaseOrderLines } from '@/lib/data/purchase-orders';
import { listPoReceiptsForPO } from '@/lib/data/po-receipts';
import { listBillsForPo } from '@/lib/data/po-bills';
import {
  expectedCostCodeFor,
  listCategoryCostCodes,
  vendorNumbersByItem,
} from '@/lib/data/vendor-item-numbers';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { getVendor } from '@/lib/data/vendors';
import { CancelRemainingButton } from '@/modules/purchase-orders/components/cancel-remaining-button';
import { RenamePoNumber } from '@/modules/purchase-orders/components/rename-po-number';
import { VendorInvoiceNumberEditor } from '@/modules/purchase-orders/components/vendor-invoice-number-editor';
import { PoLinesTable } from '@/modules/purchase-orders/components/po-lines-table';
import { PoReceiptHistory } from '@/modules/purchase-orders/components/po-receipt-history';
import { ActivityLogCard } from '@/modules/status/components/activity-log-card';
import { StatusBadge } from '@/modules/status/components/status-badge';
import { StatusPanel } from '@/modules/status/components/status-panel';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const fromProject = from === 'project';
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'purchase_orders');
  const allowBill = canCreate(role, 'receipts');
  const po = await getPurchaseOrder(companyId, id);
  if (!po) notFound();

  const vendor = await getVendor(companyId, po.vendorId);
  const activeCompany = await getActiveCompany();
  const poLimit =
    activeCompany.poApprovalLimit === null ? null : Number(activeCompany.poApprovalLimit);
  const approvalNames = await getUserNamesByIds(
    [po.createdByUserId, po.approvedByUserId].filter((x): x is string => Boolean(x)),
  );
  const project = await getProject(companyId, po.projectId);
  const customer = project ? await getCustomer(companyId, project.customerId) : undefined;
  const lines = await getPurchaseOrderLines(po.id);
  const codeMap = await loadCostCodeMap(companyId, lines.map((l) => l.costCodeId));
  // Split-PO lines: resolve names for line-level job overrides so the
  // table can say which job each overridden line books to.
  const lineProjectIds = [
    ...new Set(
      lines
        .map((l) => l.projectId)
        .filter((x): x is string => Boolean(x) && x !== po.projectId),
    ),
  ];
  const lineProjectNames = new Map<string, string>();
  for (const pid of lineProjectIds) {
    const p = await getProject(companyId, pid);
    if (p) lineProjectNames.set(pid, p.name);
  }
  const landedCost = po.landedCostEntryId
    ? await getLandedCost(companyId, po.landedCostEntryId)
    : undefined;
  const receipts = await listPoReceiptsForPO(po.id);
  // Vendor invoices billed from this PO — several per PO is normal
  // (partial shipments each arrive with their own ABC invoice).
  const bills = await listBillsForPo(companyId, po.id);
  const billedTotal = bills.reduce((s, b) => s + Number(b.total), 0);

  // Product links are editable inline in ANY status but void — the item
  // catalog often gets organized after orders were received, and the Edit
  // form is (rightly) unavailable by then. Linking backfills stock.
  const canLinkProducts = allowCreate && po.status !== 'void';
  const inventoryItems = await listInventoryItems(companyId);
  const itemNameById = new Map(inventoryItems.map((p) => [p.id, p.name]));
  const itemById = new Map(inventoryItems.map((p) => [p.id, p]));
  const [vendorNumbers, categoryDefaults] = await Promise.all([
    vendorNumbersByItem(companyId),
    listCategoryCostCodes(companyId),
  ]);
  const expectedCodeMap = await loadCostCodeMap(
    companyId,
    lines
      .map((l) =>
        expectedCostCodeFor(
          l.inventoryItemId ? itemById.get(l.inventoryItemId) : undefined,
          categoryDefaults,
        ),
      )
      .filter((x): x is string => Boolean(x)),
  );
  const products = canLinkProducts
    ? inventoryItems.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        sku: p.sku,
        unit: p.unit,
        defaultCost: Number(p.defaultCost),
        defaultCostCodeId: p.defaultCostCodeId ?? null,
        vendorNumbers: vendorNumbers.get(p.id) ?? [],
      }))
    : [];

  // Receiving is meaningful for any non-draft, non-closed, non-void PO.
  // Per the Phase 6.1 decisions, the button stays visible even when the PO
  // is fully received so a late shipment or correction can be logged until
  // the PO is explicitly closed.
  const canReceive =
    allowCreate &&
    po.status !== 'draft' &&
    po.status !== 'closed' &&
    po.status !== 'void';

  const subtotal = Number(po.subtotal);
  const tax = Number(po.taxAmount);
  const shipping = Number(po.shipping);
  const total = Number(po.total);

  const totalOrdered = lines.reduce((acc, l) => acc + Number(l.quantityOrdered), 0);
  const totalReceived = lines.reduce((acc, l) => acc + Number(l.quantityReceived), 0);
  const receivedPct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumbs
        items={[
          ...(fromProject && project
            ? [{ href: `/projects/${project.id}`, label: project.name }]
            : []),
          { href: '/purchase-orders', label: 'Purchase Orders' },
          { label: po.number },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <BackButton
          listHref="/purchase-orders"
          listLabel="Purchase Orders"
          projectId={fromProject ? po.projectId : null}
          projectName={project?.name}
        />
        <div className="flex items-center gap-2">
          {/* Bills only from issued orders — a draft PO billed before issue
              skips auto-receiving (createPoReceipt refuses drafts), leaving
              quantities at 0 while the bill posts. Issue first, then bill. */}
          {allowBill &&
            (po.status === 'issued' ||
              po.status === 'partially_received' ||
              po.status === 'received') && (
              <Link href={{ pathname: `/purchase-orders/${po.id}/bill` }}>
                <Button size="sm" variant="outline">
                  Create bill
                </Button>
              </Link>
            )}
          {allowBill && po.status === 'draft' && (
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Issue this PO first — bills can only be created from issued orders."
            >
              Create bill
            </Button>
          )}
          <DocumentDownloadButtons type="purchase_order" id={po.id} />
          {/* Editable until fully received / closed / void — committed
              cost recomputes from the lines, receipts survive by line id. */}
          {allowCreate &&
            po.status !== 'received' &&
            po.status !== 'closed' &&
            po.status !== 'void' && (
              <Link href={{ pathname: `/purchase-orders/${po.id}/edit` }}>
                <Button size="sm" variant="outline">
                  Edit
                </Button>
              </Link>
            )}
          {canReceive && (
            <Link href={{ pathname: `/purchase-orders/${po.id}/receive` }}>
              <Button size="sm" variant="outline">
                Receive shipment
              </Button>
            </Link>
          )}
          {/* Close short: the supplier won't ship the rest. Trims lines to
              what arrived + closes, so the remainder stops being committed
              cost. Void covers the nothing-arrived case. */}
          {allowCreate &&
            (po.status === 'issued' ||
              po.status === 'partially_received' ||
              po.status === 'received') && (
              <CancelRemainingButton
                poId={po.id}
                remainingValue={lines.reduce(
                  (s, l) =>
                    s +
                    Math.max(
                      0,
                      (Number(l.quantityOrdered) - Number(l.quantityReceived)) *
                        Number(l.unitCost),
                    ),
                  0,
                )}
              />
            )}
          {allowCreate && po.status !== 'void' && (
            <Link
              href={{ pathname: '/purchase-orders/new', query: { cloneFrom: po.id } }}
            >
              <Button size="sm" variant="outline">
                Duplicate
              </Button>
            </Link>
          )}
          {allowCreate && (
            <Link href="/purchase-orders/new">
              <Button size="sm">New Purchase Order</Button>
            </Link>
          )}
        </div>
      </div>

      <DocumentBranding />

      <div className="flex items-start justify-between gap-4">
        <div>
          {allowCreate ? (
            <RenamePoNumber poId={po.id} number={po.number} />
          ) : (
            <p className="font-mono text-xs text-slate-500">{po.number}</p>
          )}
          <h1 className="text-2xl font-semibold text-slate-900">
            {vendor?.name ?? 'Purchase order'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {project && (
              <Link href={`/projects/${project.id}`} className="hover:underline">
                {project.name}
              </Link>
            )}
            {customer && (
              <>
                <span className="text-slate-400">·</span>
                <span>{customer.name}</span>
              </>
            )}
          </div>
          {/* One PO can be split across jobs line by line. When it is, name
              the other jobs here so the split isn't buried in the table. */}
          {lineProjectIds.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Also billed to{' '}
              {lineProjectIds
                .map((pid) => lineProjectNames.get(pid) ?? 'another job')
                .join(', ')}{' '}
              — set per line in the Job column.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Vendor invoice #
            </span>
            {allowCreate ? (
              <VendorInvoiceNumberEditor
                poId={po.id}
                value={po.vendorInvoiceNumber}
              />
            ) : (
              <span className="font-mono text-xs text-slate-700">
                {po.vendorInvoiceNumber ?? '—'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {po.grir && (
            <span
              className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800"
              title="Goods receipts book the cost (Dr expense / Cr GR/IR); bills are 3-way matched and clear GR/IR."
            >
              GR/IR
            </span>
          )}
          <StatusBadge entityType="purchase_order" status={po.status} />
        </div>
      </div>

      {poLimit !== null &&
        Number(po.total) > poLimit &&
        (po.status === 'draft' || po.approvedAt) &&
        po.status !== 'void' && (
          <PoApprovalPanel
            poId={po.id}
            status={po.status}
            total={Number(po.total)}
            limit={poLimit}
            approved={
              po.approvedAt
                ? {
                    byName: po.approvedByUserId
                      ? (approvalNames.get(po.approvedByUserId) ?? null)
                      : null,
                    at: po.approvedAt.toISOString().slice(0, 10),
                    total: Number(po.approvedTotal ?? 0),
                  }
                : null
            }
            creatorName={
              po.createdByUserId ? (approvalNames.get(po.createdByUserId) ?? null) : null
            }
            canApprove={canApproveReceipt(role)}
          />
        )}

      <StatusPanel
        entityType="purchase_order"
        entityId={po.id}
        status={po.status}
        timestamps={[
          { label: 'Created', value: po.createdAt },
          { label: 'Issued', value: po.issuedAt },
          { label: 'Closed', value: po.closedAt },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(total)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Order date</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {po.issueDate ?? '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Expected delivery
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {po.expectedDeliveryDate ?? '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Received</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {receivedPct.toFixed(0)}%
            </p>
            <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {totalReceived.toLocaleString(undefined, { maximumFractionDigits: 2 })} /{' '}
              {totalOrdered.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Vendor</CardTitle>
            {vendor && (
              <Link href={`/vendors/${vendor.id}`}>
                <Button size="sm" variant="outline">
                  View Vendor →
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {vendor ? (
            <>
              <Row label="Name" value={vendor.name} />
              <Row label="Email" value={vendor.email ?? '—'} />
              <Row label="Phone" value={vendor.phone ?? '—'} />
              <Row label="Default terms" value={vendor.defaultTerms ?? '—'} />
              <Row
                label="Subcontractor"
                value={vendor.isSubcontractor ? 'Yes' : 'No'}
              />
            </>
          ) : (
            <span className="text-slate-500">Vendor not found</span>
          )}
        </CardContent>
      </Card>

      {landedCost && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Landed cost / shipping</CardTitle>
              <Link href={`/landed-cost/${landedCost.id}`}>
                <Button size="sm" variant="outline">
                  View Landed Cost →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Calculation" value={landedCost.name} />
            <Row label="Carrier" value={landedCost.carrier ?? '—'} />
            <Row label="CIF value" value={formatMoney(landedCost.cif)} />
            <Row
              label={`Duty (${Number(landedCost.dutyPercent).toFixed(2)}%)`}
              value={formatMoney(landedCost.dutyAmount)}
            />
            <Row
              label={`VAT (${Number(landedCost.vatPercent).toFixed(2)}%)`}
              value={formatMoney(landedCost.vatAmount)}
            />
            <Row
              label="Total landed cost"
              value={formatMoney(landedCost.totalLandedCost)}
            />
            <Row
              label="Per unit"
              value={formatMoney(landedCost.perUnitCost)}
            />
            <p className="text-xs text-slate-500 mt-2">
              Landed cost reflects the all-in delivered cost (vendor + handling +
              freight + duty + VAT + local fees). Use this as the true cost basis
              when estimating sell prices for these materials.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Line items ({lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No line items on this purchase order.
            </div>
          ) : (
            <PoLinesTable
              lines={lines.map((l) => {
                const overridden = Boolean(
                  l.projectId && l.projectId !== po.projectId,
                );
                return {
                  id: l.id,
                  costCode: codeMap.get(l.costCodeId)?.code ?? '—',
                  jobName: overridden
                    ? (lineProjectNames.get(l.projectId!) ?? 'other job')
                    : (project?.name ?? '—'),
                  jobOverridden: overridden,
                  description: l.description,
                  unit: l.unit,
                  quantityOrdered: Number(l.quantityOrdered),
                  quantityReceived: Number(l.quantityReceived),
                  unitCost: l.unitCost,
                  lineTotal: l.lineTotal,
                  inventoryItemId: l.inventoryItemId ?? '',
                  inventoryItemName: l.inventoryItemId
                    ? (itemNameById.get(l.inventoryItemId) ?? null)
                    : null,
                  expectedCostCode: (() => {
                    const expected = expectedCostCodeFor(
                      l.inventoryItemId
                        ? itemById.get(l.inventoryItemId)
                        : undefined,
                      categoryDefaults,
                    );
                    return expected && expected !== l.costCodeId
                      ? (expectedCodeMap.get(expected)?.code ?? null)
                      : null;
                  })(),
                };
              })}
              poId={po.id}
              products={products}
              canEditProducts={canLinkProducts}
              vendorId={po.vendorId}
              vendorName={vendor?.name ?? null}
            />
          )}
        </CardContent>
      </Card>

      {/* Vendor invoices billed from this PO — the AP side of the order.
          Several per PO is normal: partial shipments each arrive with
          their own vendor invoice. */}
      {bills.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Invoices ({bills.length})</CardTitle>
              <span className="text-sm text-slate-600">
                Billed so far:{' '}
                <span
                  className={`font-medium tabular-nums ${
                    Math.abs(billedTotal - total) <= 0.01
                      ? 'text-emerald-700'
                      : billedTotal > total + 0.01
                        ? 'text-red-600'
                        : 'text-amber-700'
                  }`}
                >
                  {formatMoney(billedTotal)}
                </span>{' '}
                of {formatMoney(total)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Bill date</th>
                  <th className="px-4 py-2">Vendor invoice #</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">
                      {b.receiptDate}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={{ pathname: `/banking/receipts/${b.id}` }}
                        className="text-blue-700 hover:underline"
                      >
                        {b.vendorInvoiceNumber ?? '(no number)'}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs border ${
                          b.status === 'posted'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : b.status === 'void'
                              ? 'bg-red-50 border-red-200 text-red-700'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
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

      {(receipts.length > 0 || canReceive) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Receiving history ({receipts.length})</CardTitle>
              {canReceive && (
                <Link href={{ pathname: `/purchase-orders/${po.id}/receive` }}>
                  <Button size="sm" variant="outline">
                    Receive shipment
                  </Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <PoReceiptHistory
              poId={po.id}
              receipts={receipts.map((r) => {
                const totalQty = r.lines.reduce(
                  (acc, l) => acc + Number(l.quantityReceived),
                  0,
                );
                return {
                  id: r.id,
                  receivedAt: r.receivedAt
                    .toISOString()
                    .slice(0, 10),
                  notes: r.notes,
                  totalQty,
                  lineCount: r.lines.length,
                };
              })}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Subtotal</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(subtotal)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Tax</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(tax)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Freight / duty
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(shipping)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
          </CardContent>
        </Card>
      </div>

      {po.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-slate-800">
            {po.notes}
          </CardContent>
        </Card>
      )}

      <CompanyStandardTerms />

      <DocumentFlowCard companyId={companyId} anchor={{ type: 'purchase_order', id: po.id }} />
      <ActivityLogCard entityType="purchase_order" entityId={po.id} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  );
}
