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
import {
  getPurchaseOrderLines,
  listPurchaseOrdersForVendor,
} from '@/lib/data/purchase-orders';
import { getProject } from '@/lib/data/projects';
import { getVendor } from '@/lib/data/vendors';
import { listImportedTransactions } from '@/lib/data/statement-imports';
import {
  STATUS_LABEL as PO_STATUS_LABEL,
  STATUS_TONE as PO_STATUS_TONE,
} from '@/modules/purchase-orders/schema';
import { ArchiveVendorForm } from '@/modules/vendors/components/archive-vendor-form';
import { TYPE_LABEL, TYPE_TONE } from '@/modules/vendors/schema';

export const dynamic = 'force-dynamic';

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'vendors');
  const vendor = await getVendor(companyId, id);
  if (!vendor) notFound();

  const pos = (await listPurchaseOrdersForVendor(vendor.id)).filter((p) => p.status !== 'void');
  // Bank transactions tagged to this supplier — newest first.
  const vendorTxns = await listImportedTransactions(companyId, {
    vendorId: vendor.id,
    includeIgnored: true,
    limit: 100,
  });

  let committed = 0;
  let received = 0;
  let openCount = 0;
  const linkedProjectIds = new Set<string>();

  for (const po of pos) {
    committed += Number(po.total);
    linkedProjectIds.add(po.projectId);
    if (po.status !== 'received' && po.status !== 'closed') openCount += 1;
    for (const line of await getPurchaseOrderLines(po.id)) {
      received += Number(line.quantityReceived) * Number(line.unitCost);
    }
  }

  const linkedProjects = (
    await Promise.all(
      Array.from(linkedProjectIds).map(async (pid) => await getProject(companyId, pid)),
    )
  ).filter((p): p is NonNullable<typeof p> => Boolean(p));

  const type = vendor.isSubcontractor ? 'subcontractor' : 'supplier';
  const address = [vendor.addressLine1, vendor.city, vendor.state, vendor.postalCode]
    .filter(Boolean)
    .join(', ');

  const openPOs = pos.filter((p) => p.status !== 'received' && p.status !== 'closed');
  const openPOsWithProject = await Promise.all(
    openPOs.map(async (po) => ({
      po,
      project: await getProject(companyId, po.projectId),
    })),
  );
  const posWithProject = await Promise.all(
    pos.map(async (po) => ({
      po,
      project: await getProject(companyId, po.projectId),
    })),
  );

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumbs
        items={[{ href: '/vendors', label: 'Vendors' }, { label: vendor.name }]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/vendors">
          <Button variant="outline" size="sm">
            ← Back to Vendors
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {allowCreate && (
            <Link href={{ pathname: `/vendors/${vendor.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          )}
          {allowCreate && <ArchiveVendorForm id={vendor.id} />}
          {allowCreate && (
            <Link href="/vendors/new">
              <Button size="sm">New Vendor</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{vendor.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {vendor.primaryContactName && <span>{vendor.primaryContactName}</span>}
            {vendor.email && <span className="text-slate-400">·</span>}
            {vendor.email && <span>{vendor.email}</span>}
            {vendor.phone && <span className="text-slate-400">·</span>}
            {vendor.phone && <span>{vendor.phone}</span>}
          </div>
        </div>
        <Badge tone={TYPE_TONE[type]}>{TYPE_LABEL[type]}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Open POs" value={String(openCount)} sub={`${pos.length} total`} />
        <KPI label="Committed" value={formatMoney(committed)} />
        <KPI label="Received" value={formatMoney(received)} />
        <KPI label="Linked projects" value={String(linkedProjects.length)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Company" value={vendor.name} />
            <Row label="Type" value={TYPE_LABEL[type]} />
            <Row label="Primary contact" value={vendor.primaryContactName ?? '—'} />
            <Row label="Email" value={vendor.email ?? '—'} />
            <Row label="Phone" value={vendor.phone ?? '—'} />
            <Row label="Payment terms" value={vendor.defaultTerms ?? '—'} />
            <Row label="W-9 on file" value={vendor.w9OnFile ? 'Yes' : 'No'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {address ? (
              <div className="space-y-1">
                {vendor.addressLine1 && (
                  <div className="text-slate-900">{vendor.addressLine1}</div>
                )}
                {(vendor.city || vendor.state || vendor.postalCode) && (
                  <div className="text-slate-700">
                    {[vendor.city, vendor.state, vendor.postalCode]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-slate-500">No address on file</span>
            )}
          </CardContent>
        </Card>
      </div>

      {vendor.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">
            {vendor.notes}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Open purchase orders ({openPOs.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {openPOs.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No open POs against this vendor.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openPOsWithProject.map(({ po, project }) => {
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {po.number}
                      </TableCell>
                      <TableCell className="text-slate-900">
                        {project?.name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge tone={PO_STATUS_TONE[po.status]}>
                          {PO_STATUS_LABEL[po.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {po.issueDate ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(po.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/purchase-orders/${po.id}`}>
                          <Button size="sm" variant="outline">
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All purchase orders ({pos.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pos.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No purchase orders against this vendor yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {posWithProject.map(({ po, project }) => {
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {po.number}
                      </TableCell>
                      <TableCell className="text-slate-900">
                        {project?.name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge tone={PO_STATUS_TONE[po.status]}>
                          {PO_STATUS_LABEL[po.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(po.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/purchase-orders/${po.id}`}>
                          <Button size="sm" variant="outline">
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank transactions ({vendorTxns.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {vendorTxns.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No bank transactions tagged to this supplier yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-32">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorTxns.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums text-slate-700">
                      {t.transactionDate}
                    </TableCell>
                    <TableCell className="text-slate-900">
                      <Link
                        href={`/banking/transactions/${t.id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {t.description || t.payee || '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(t.amount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked projects ({linkedProjects.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {linkedProjects.length === 0 ? (
            <span className="text-slate-500">No projects connected to this vendor.</span>
          ) : (
            <ul className="divide-y divide-slate-100">
              {linkedProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-slate-900">{p.name}</div>
                  </div>
                  <Link href={`/projects/${p.id}`}>
                    <Button size="sm" variant="outline">
                      View Project
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
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
