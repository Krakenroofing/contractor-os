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
  getMockCostCode,
  getMockCustomer,
  getMockEstimate,
  getMockEstimateLineItems,
  getMockProject,
} from '@/lib/mock-store';
import { STATUS_LABEL, STATUS_TONE } from '@/modules/estimates/schema';

export const dynamic = 'force-dynamic';

function formatDate(d: Date | string | null) {
  if (!d) return '—';
  if (typeof d === 'string') return d;
  return d.toISOString().slice(0, 10);
}

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'estimates');
  const estimate = getMockEstimate(companyId, id);
  if (!estimate) notFound();

  const project = getMockProject(companyId, estimate.projectId);
  const customer = project ? getMockCustomer(companyId, project.customerId) : undefined;
  const lines = getMockEstimateLineItems(estimate.id);

  const subtotal = Number(estimate.subtotal);
  const total = Number(estimate.total);
  const markup = total - subtotal;
  const effectiveMarkupPct = subtotal > 0 ? (markup / subtotal) * 100 : 0;

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumbs
        items={[
          { href: '/estimates', label: 'Estimates' },
          { label: estimate.number },
        ]}
      />

      <div className="flex items-center justify-between">
        <Link href="/estimates">
          <Button variant="outline" size="sm">
            ← Back to Estimates
          </Button>
        </Link>
        {allowCreate && (
          <Link href="/estimates/new">
            <Button size="sm">New Estimate</Button>
          </Link>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-slate-500">{estimate.number}</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project?.name ?? 'Estimate'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {customer && <span>{customer.name}</span>}
            {project && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.number}
                </Link>
              </>
            )}
          </div>
        </div>
        <Badge tone={STATUS_TONE[estimate.status]}>{STATUS_LABEL[estimate.status]}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Subtotal</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(subtotal)}</p>
            <p className="mt-0.5 text-xs text-slate-500">cost before markup</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Markup</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
              {formatMoney(markup)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {effectiveMarkupPct.toFixed(1)}% effective
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
            <p className="mt-0.5 text-xs text-slate-500">customer-facing</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Created</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatDate(estimate.createdAt)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {estimate.validUntil ? `valid until ${estimate.validUntil}` : 'no expiry'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line items ({lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No line items on this estimate.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Markup %</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const code = getMockCostCode(companyId, l.costCodeId);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {code?.code ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-900">{l.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(l.quantity).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-slate-600">{l.unit ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.unitCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {Number(l.markupPercent).toFixed(1)}%
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
    </div>
  );
}
