import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/back-button';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { CalcBreakdown } from '@/components/calc-breakdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, round2 } from '@/lib/money';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getLandedCost,
  listLandedCostAttachments,
} from '@/lib/data/landed-costs';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { getProject } from '@/lib/data/projects';
import { getVendor } from '@/lib/data/vendors';
import {
  STATUS_LABEL as PO_STATUS_LABEL,
  STATUS_TONE as PO_STATUS_TONE,
} from '@/modules/purchase-orders/schema';
import { ReconcileButton } from '@/modules/landed-cost/components/reconcile-button';
import { ShippingDocuments } from '@/modules/landed-cost/components/shipping-documents';

export const dynamic = 'force-dynamic';

export default async function LandedCostDetailPage({
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
  const allowEdit = canCreate(role, 'landed_cost');
  const lc = await getLandedCost(companyId, id);
  if (!lc) notFound();

  const attachments = await listLandedCostAttachments(companyId, lc.id);
  const project = lc.projectId ? await getProject(companyId, lc.projectId) : undefined;
  const vendor = lc.vendorId ? await getVendor(companyId, lc.vendorId) : undefined;
  const linkedPOs = (await listPurchaseOrders(companyId)).filter(
    (p) => p.landedCostEntryId === lc.id,
  );
  const linkedPOsWithVendor = await Promise.all(
    linkedPOs.map(async (po) => ({
      po,
      vendor: await getVendor(companyId, po.vendorId),
    })),
  );

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <Breadcrumbs
        items={[
          ...(fromProject && project
            ? [{ href: `/projects/${project.id}`, label: project.name }]
            : []),
          { href: '/landed-cost', label: 'Landed Cost / Shipping' },
          { label: lc.name },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <BackButton
          listHref="/landed-cost"
          listLabel="Landed Cost"
          projectId={fromProject ? project?.id : null}
          projectName={project?.name}
        />
        {allowEdit && (
          <Link href={{ pathname: `/landed-cost/${lc.id}/edit` }}>
            <Button size="sm" variant="outline">
              Edit
            </Button>
          </Link>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-slate-500">
            Landed cost entry{lc.tariffCode ? ` · HS ${lc.tariffCode}` : ''}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">{lc.name}</h1>
          {lc.itemDescription && (
            <p className="text-sm text-slate-700 mt-0.5">{lc.itemDescription}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {lc.carrier && <span>Carrier: {lc.carrier}</span>}
            {project && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
              </>
            )}
            {vendor && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/vendors/${vendor.id}`} className="hover:underline">
                  {vendor.name}
                </Link>
              </>
            )}
          </div>
        </div>
        <Badge tone="blue">{lc.carrier ?? 'Carrier'}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="FOB" value={formatMoney(lc.fob)} />
        <KPI label="CIF" value={formatMoney(lc.cif)} />
        <KPI
          label="Total landed cost"
          value={formatMoney(lc.totalLandedCost)}
          valueClassName="text-emerald-700"
        />
        <KPI
          label="Per unit"
          value={formatMoney(lc.perUnitCost)}
          sub={`${Number(lc.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} units`}
        />
      </div>

      {/* Estimate → actual variance */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Estimate vs actual</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">
                {lc.reconciledAt
                  ? `Reconciled ${new Date(lc.reconciledAt).toLocaleDateString()} — the figures below are the confirmed actuals.`
                  : 'Estimate. Edit this entry with the broker/Tropical numbers as they arrive, then mark it reconciled.'}
              </p>
            </div>
            {allowEdit && lc.estimateSnapshot && (
              <ReconcileButton id={lc.id} reconciled={lc.reconciledAt != null} />
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!lc.estimateSnapshot ? (
            <p className="px-6 py-4 text-sm text-slate-500">
              No estimate snapshot — this entry predates estimate/actual
              tracking. New entries capture one automatically at creation.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ['Material', lc.estimateSnapshot.materialCost, lc.materialCost],
                    ['FL delivery', lc.estimateSnapshot.flDelivery, lc.flDelivery],
                    ['Crating', lc.estimateSnapshot.crating, lc.crating],
                    ['Freight', lc.estimateSnapshot.freightCost, lc.freightCost],
                    ['Insurance', lc.estimateSnapshot.insurance, lc.insurance],
                    ['Duty', lc.estimateSnapshot.dutyAmount, lc.dutyAmount],
                    ['Excise', lc.estimateSnapshot.exciseAmount, lc.exciseAmount],
                    ['Env. levy', lc.estimateSnapshot.envLevyAmount, lc.envLevyAmount],
                    ['Processing fee', lc.estimateSnapshot.processingFeeAmount, lc.processingFeeAmount],
                    ['VAT', lc.estimateSnapshot.vatAmount, lc.vatAmount],
                    ['Brokerage', lc.estimateSnapshot.brokerage, lc.brokerage],
                    ['Port / terminal', lc.estimateSnapshot.portFees, lc.portFees],
                    ['Local delivery', lc.estimateSnapshot.localDelivery, lc.localDelivery],
                    ['Total landed cost', lc.estimateSnapshot.totalLandedCost, lc.totalLandedCost, true],
                    ['Per unit', lc.estimateSnapshot.perUnitCost, lc.perUnitCost, true],
                  ] as [string, number, string, boolean?][]
                )
                  .map(([label, est, actRaw, bold]) => {
                    const act = Number(actRaw);
                    return [label, est, act, bold] as const;
                  })
                  .filter(([, est, act, bold]) => bold || est !== 0 || act !== 0)
                  .map(([label, est, act, bold]) => {
                    const delta = round2(act - est);
                    const pct = est !== 0 ? (delta / est) * 100 : null;
                    const tone =
                      delta > 0
                        ? 'text-red-600'
                        : delta < 0
                          ? 'text-emerald-700'
                          : 'text-slate-400';
                    return (
                      <TableRow key={label}>
                        <TableCell className={bold ? 'font-semibold' : ''}>
                          {label}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {formatMoney(est)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${bold ? 'font-semibold text-slate-900' : ''}`}
                        >
                          {formatMoney(act)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${tone}`}>
                          {delta === 0
                            ? '—'
                            : `${delta > 0 ? '+' : ''}${formatMoney(delta)}${pct != null ? ` (${delta > 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}`}
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
          <CardTitle>Cost build-up</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <Row label="Material / vendor cost" value={lc.materialCost} />
              <Row label="FL delivery & handling" value={lc.flDelivery} />
              <Row label="Crating" value={lc.crating} />
              <SubtotalRow label="FOB" value={lc.fob} />
              <Row label="Freight cost" value={lc.freightCost} />
              <Row label="Insurance" value={lc.insurance} />
              <SubtotalRow label="CIF" value={lc.cif} />
              <Row
                label={`Duty (${Number(lc.dutyPercent).toFixed(2)}%)`}
                value={lc.dutyAmount}
              />
              {Number(lc.excisePercent) > 0 && (
                <Row
                  label={`Excise (${Number(lc.excisePercent).toFixed(2)}%)`}
                  value={lc.exciseAmount}
                />
              )}
              {Number(lc.envLevyPercent) > 0 && (
                <Row
                  label={`Environmental levy (${Number(lc.envLevyPercent).toFixed(2)}%)`}
                  value={lc.envLevyAmount}
                />
              )}
              <Row
                label="Processing fee (1% of value, max $1,000)"
                value={lc.processingFeeAmount}
              />
              <Row
                label={`VAT (${Number(lc.vatPercent).toFixed(2)}%)`}
                value={lc.vatAmount}
              />
              <Row label="Brokerage fees" value={lc.brokerage} />
              <Row label="Port / terminal fees" value={lc.portFees} />
              <Row label="Local delivery" value={lc.localDelivery} />
              <SubtotalRow label="Total landed cost" value={lc.totalLandedCost} bold />
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipping documents ({attachments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ShippingDocuments
            landedCostId={lc.id}
            allowEdit={allowEdit}
            documents={attachments.map((a) => ({
              id: a.id,
              originalFileName: a.originalFileName,
              byteSize: a.byteSize,
              uploadedAt:
                a.uploadedAt instanceof Date
                  ? a.uploadedAt.toISOString()
                  : String(a.uploadedAt),
            }))}
          />
        </CardContent>
      </Card>

      <CalcBreakdown
        title={`Calculation breakdown — ${lc.name}`}
        steps={[
          {
            label: 'Supplier subtotal',
            formula: 'quantity × unit cost',
            value: Number(lc.materialCost),
          },
          {
            label: 'FL delivery + crating (handling)',
            formula: 'flDelivery + crating',
            value:
              Number(lc.flDelivery) + Number(lc.crating),
          },
          {
            label: 'CIF',
            formula: 'supplier subtotal + freight + insurance',
            value: Number(lc.cif),
            emphasis: true,
          },
          {
            label: `Duty @ ${Number(lc.dutyPercent).toFixed(2)}%`,
            formula: 'CIF × duty %',
            value: Number(lc.dutyAmount),
          },
          {
            label: `Excise @ ${Number(lc.excisePercent).toFixed(2)}%`,
            formula: 'CIF × excise %',
            value: Number(lc.exciseAmount),
          },
          {
            label: `Env. levy @ ${Number(lc.envLevyPercent).toFixed(2)}%`,
            formula: 'CIF × env levy %',
            value: Number(lc.envLevyAmount),
          },
          {
            label: 'Processing fee',
            formula: 'min(value × 1%, $1,000)',
            value: Number(lc.processingFeeAmount),
          },
          {
            label: 'VAT base',
            formula: 'CIF + duty + excise + env levy + processing fee',
            value:
              Number(lc.cif) +
              Number(lc.dutyAmount) +
              Number(lc.exciseAmount) +
              Number(lc.envLevyAmount) +
              Number(lc.processingFeeAmount),
          },
          {
            label: `VAT @ ${Number(lc.vatPercent).toFixed(2)}%`,
            formula: 'VAT base × VAT %',
            value: Number(lc.vatAmount),
          },
          {
            label: 'Local fees',
            formula: 'brokerage + port + local delivery',
            value:
              Number(lc.brokerage) +
              Number(lc.portFees) +
              Number(lc.localDelivery),
          },
          {
            label: 'Total landed cost',
            formula:
              'supplier + freight + insurance + duty + excise + envLevy + processing fee + VAT + local + handling',
            value: Number(lc.totalLandedCost),
            emphasis: true,
          },
          {
            label: 'Per unit',
            formula: 'total ÷ quantity',
            value: Number(lc.perUnitCost),
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Linked purchase orders ({linkedPOs.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {linkedPOs.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No purchase orders are using this landed-cost entry yet. Pick it from the
              "Linked landed-cost entry" selector when creating a PO.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">PO total</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedPOsWithVendor.map(({ po, vendor }) => {
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {po.number}
                      </TableCell>
                      <TableCell className="text-slate-900">
                        {vendor?.name ?? '—'}
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

      {lc.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{lc.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-slate-500 tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-slate-700">{label}</TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(value)}</TableCell>
    </TableRow>
  );
}

function SubtotalRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <TableRow className="bg-slate-50">
      <TableCell className={bold ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}>
        {label}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums ${
          bold ? 'font-semibold text-slate-900' : 'font-medium'
        }`}
      >
        {formatMoney(value)}
      </TableCell>
    </TableRow>
  );
}
