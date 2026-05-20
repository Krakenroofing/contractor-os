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
import { CompanyStandardTerms } from '@/components/company-standard-terms';
import { DocumentBranding } from '@/components/document-branding';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { getLandedCost } from '@/lib/data/landed-costs';
import { getPurchaseOrder, getPurchaseOrderLines } from '@/lib/data/purchase-orders';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { getVendor } from '@/lib/data/vendors';
import { ActivityLogCard } from '@/modules/status/components/activity-log-card';
import { StatusBadge } from '@/modules/status/components/status-badge';
import { StatusPanel } from '@/modules/status/components/status-panel';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'purchase_orders');
  const po = await getPurchaseOrder(companyId, id);
  if (!po) notFound();

  const vendor = await getVendor(companyId, po.vendorId);
  const project = await getProject(companyId, po.projectId);
  const customer = project ? await getCustomer(companyId, project.customerId) : undefined;
  const lines = await getPurchaseOrderLines(po.id);
  const codeMap = await loadCostCodeMap(companyId, lines.map((l) => l.costCodeId));
  const landedCost = po.landedCostEntryId
    ? await getLandedCost(companyId, po.landedCostEntryId)
    : undefined;

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
          { href: '/purchase-orders', label: 'Purchase Orders' },
          { label: po.number },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/purchase-orders">
          <Button variant="outline" size="sm">
            ← Back to Purchase Orders
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {allowCreate && po.status === 'draft' && (
            <Link href={{ pathname: `/purchase-orders/${po.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
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
          <p className="font-mono text-xs text-slate-500">{po.number}</p>
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
        </div>
        <StatusBadge entityType="purchase_order" status={po.status} />
      </div>

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost code</TableHead>
                  <TableHead>Item description</TableHead>
                  <TableHead className="text-right">Qty ordered</TableHead>
                  <TableHead className="text-right">Qty received</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const code = codeMap.get(l.costCodeId);
                  const ordered = Number(l.quantityOrdered);
                  const received = Number(l.quantityReceived);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {code?.code ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-900">{l.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ordered.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          received < ordered ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {received.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-slate-600">{l.unit ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.unitCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(l.lineTotal)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
