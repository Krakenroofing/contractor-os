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
import { CompanyStandardTerms } from '@/components/company-standard-terms';
import { DocumentBranding } from '@/components/document-branding';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { getChangeOrder, getChangeOrderLineItems } from '@/lib/data/change-orders';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { getProposal } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  REASON_LABEL,
  STATUS_LABEL,
} from '@/modules/change-orders/schema';
import { ActivityLogCard } from '@/modules/status/components/activity-log-card';
import { StatusBadge } from '@/modules/status/components/status-badge';
import { StatusPanel } from '@/modules/status/components/status-panel';

export const dynamic = 'force-dynamic';

export default async function ChangeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'change_orders');
  const co = await getChangeOrder(companyId, id);
  if (!co) notFound();

  const project = await getProject(companyId, co.projectId);
  const customer = project ? await getCustomer(companyId, project.customerId) : undefined;
  const proposal = co.proposalId
    ? await getProposal(companyId, co.proposalId)
    : undefined;
  const lines = await getChangeOrderLineItems(co.id);
  const codeMap = await loadCostCodeMap(companyId, lines.map((l) => l.costCodeId));

  const subtotal = Number(co.subtotal);
  const total = Number(co.total);
  const markup = total - subtotal;

  const isApproved = co.status === 'approved';
  const isRejected = co.status === 'rejected';

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumbs
        items={[
          { href: '/change-orders', label: 'Change Orders' },
          { label: co.number },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/change-orders">
          <Button variant="outline" size="sm">
            ← Back to Change Orders
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {allowCreate && co.status !== 'void' && (
            <Link href={{ pathname: `/change-orders/${co.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          )}
          {allowCreate && (
            <Link href="/change-orders/new">
              <Button size="sm">New Change Order</Button>
            </Link>
          )}
        </div>
      </div>

      <DocumentBranding />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-slate-500">{co.number}</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project?.name ?? 'Change order'}
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
            {proposal && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/proposals/${proposal.id}`} className="hover:underline">
                  {proposal.number}
                </Link>
              </>
            )}
          </div>
        </div>
        <StatusBadge entityType="change_order" status={co.status} />
      </div>

      <StatusPanel
        entityType="change_order"
        entityId={co.id}
        status={co.status}
        timestamps={[
          { label: 'Created', value: co.createdAt },
          { label: 'Submitted', value: co.submittedAt },
          { label: 'Approved', value: co.approvedAt },
          { label: 'Rejected', value: co.rejectedAt },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Amount</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
            <p className="mt-0.5 text-xs text-slate-500">customer-facing</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Schedule impact</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {co.scheduleImpactDays}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Submitted</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {co.submittedAt ?? '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Approved</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {co.approvedAt ?? '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reason for change</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <Badge tone="slate">{REASON_LABEL[co.reason]}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scope description</CardTitle>
        </CardHeader>
        <CardContent className="text-sm whitespace-pre-wrap text-slate-800 leading-relaxed">
          {co.description || (
            <span className="text-slate-400">No description provided</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line items ({lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No line items on this change order.
            </div>
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
                  const code = codeMap.get(l.costCodeId);
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <p className="text-xs uppercase tracking-wide text-slate-500">Markup</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
              {formatMoney(markup)}
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

      <CompanyStandardTerms />

      <Card>
        <CardHeader>
          <CardTitle>Approval & signature</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {isApproved ? (
            <div className="space-y-3">
              <div className="border border-slate-200 rounded-md bg-emerald-50 px-4 py-6 italic text-emerald-800">
                Approved {co.approvedAt ?? ''}
                {co.customerSignedName ? ` · signed by ${co.customerSignedName}` : ''}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-slate-600">
                <Row label="Status" value={STATUS_LABEL[co.status]} />
                <Row label="Customer signed" value={co.customerSignedName ?? '—'} />
                <Row label="Approved on" value={co.approvedAt ?? '—'} />
              </div>
              {project && (
                <p className="text-xs text-slate-500">
                  This CO has rolled into{' '}
                  <Link href={`/projects/${project.id}`} className="hover:underline">
                    {project.number}
                  </Link>
                  's contract value and approved-CO summary.
                </p>
              )}
            </div>
          ) : isRejected ? (
            <div className="space-y-3">
              <div className="border border-slate-200 rounded-md bg-red-50 px-4 py-6 italic text-red-800">
                Rejected {co.rejectedAt ?? ''}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="border border-dashed border-slate-300 rounded-md px-4 py-10 text-center text-slate-400">
                Awaiting approval
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-slate-500">
                <Row label="Status" value={STATUS_LABEL[co.status]} />
                <Row label="Customer signed" value="—" />
                <Row label="Approved on" value="—" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ActivityLogCard entityType="change_order" entityId={co.id} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-900">{value}</p>
    </div>
  );
}
