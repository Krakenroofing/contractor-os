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
import { ArchiveProjectForm } from '@/modules/projects/components/archive-project-form';
import { RecomputeTotalsButton } from '@/modules/projects/components/recompute-totals-button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { sanitizeReturnTo, returnToLabel } from '@/lib/return-to';
import { formatMoney, parseMoney } from '@/lib/money';
import { computeRemainingBillable } from '@/modules/dashboard/lib/remaining-billable';
import { computeProjectStatusCounts } from '@/lib/status-machine';
import {
  computeProjectInvoiceSummary,
  computeProjectInvoicesByContractSource,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { getInvoicePayments } from '@/lib/data/invoice-payments';
import {
  listChangeOrdersForProject,
  getChangeOrderNumbers,
} from '@/lib/data/change-orders';
import {
  getContractReductionRefundByProjectMap,
  listCreditMemosForProject,
} from '@/lib/data/credit-memos';
import { IssueCreditMemoDialog } from '@/modules/credit-memos/components/issue-credit-memo-dialog';
import { listEstimatesForProject } from '@/lib/data/estimates';
import { listLandedCostsForProject } from '@/lib/data/landed-costs';
import { listProposalsForProject } from '@/lib/data/proposals';
import { listPurchaseOrdersForProject } from '@/lib/data/purchase-orders';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { getVendor } from '@/lib/data/vendors';
import { listDailyReportsForProject } from '@/lib/data/daily-reports';
import { listProjectDocuments } from '@/lib/data/project-documents';
import { listAssignmentsForProject } from '@/lib/data/project-assignments';
import { listEmployees } from '@/lib/data/employees';
import { CrewAssignmentsPanel } from '@/modules/project-assignments/components/crew-assignments-panel';
import { DOCUMENT_CATEGORY_LABEL } from '@/modules/project-documents/schema';
import {
  STATUS_LABEL as DR_STATUS_LABEL,
  STATUS_TONE as DR_STATUS_TONE,
} from '@/modules/daily-reports/schema';
import { computeProjectFinancials } from '@/modules/job-costing/lib/financials';
import {
  STATUS_LABEL as CO_STATUS_LABEL,
  STATUS_TONE as CO_STATUS_TONE,
} from '@/modules/change-orders/schema';
import {
  STATUS_LABEL as EST_STATUS_LABEL,
  STATUS_TONE as EST_STATUS_TONE,
} from '@/modules/estimates/schema';
import {
  STATUS_LABEL as PROP_STATUS_LABEL,
  STATUS_TONE as PROP_STATUS_TONE,
} from '@/modules/proposals/schema';
import {
  STATUS_LABEL as PO_STATUS_LABEL,
  STATUS_TONE as PO_STATUS_TONE,
} from '@/modules/purchase-orders/schema';
import type { Project } from '@/db/schema';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<
  Project['status'],
  'slate' | 'blue' | 'amber' | 'green' | 'red'
> = {
  lead: 'slate',
  estimating: 'blue',
  won: 'green',
  in_progress: 'amber',
  closed: 'green',
  lost: 'red',
};

const STATUS_LABEL: Record<Project['status'], string> = {
  lead: 'Lead',
  estimating: 'Estimating',
  won: 'Won',
  in_progress: 'In Progress',
  closed: 'Closed',
  lost: 'Lost',
};

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ showVoid?: string; returnTo?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const showVoid = sp.showVoid === '1';
  const returnTo = sanitizeReturnTo(sp.returnTo);
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'projects');
  const allowCreateEstimate = canCreate(role, 'estimates');
  const allowCreateProposal = canCreate(role, 'proposals');
  const allowCreateCO = canCreate(role, 'change_orders');
  const allowCreatePO = canCreate(role, 'purchase_orders');
  const allowCreateInvoice = canCreate(role, 'invoices');
  const allowCreateDailyReport = canCreate(role, 'daily_reports');
  const allowCreateDocument = canCreate(role, 'documents');
  const project = await getProject(companyId, id);
  if (!project) notFound();
  const customer = await getCustomer(companyId, project.customerId);
  if (!customer) notFound();

  const fin = await computeProjectFinancials(companyId, project.id);
  const estimates = await listEstimatesForProject(companyId, project.id);
  const proposals = await listProposalsForProject(companyId, project.id);
  const changeOrders = await listChangeOrdersForProject(project.id);
  const purchaseOrders = await listPurchaseOrdersForProject(project.id);
  const purchaseOrdersWithVendor = await Promise.all(
    purchaseOrders.map(async (po) => ({
      po,
      vendor: await getVendor(companyId, po.vendorId),
    })),
  );
  const landedCosts = await listLandedCostsForProject(project.id);
  const dailyReports = await listDailyReportsForProject(companyId, project.id);
  const recentDailyReports = dailyReports.slice(0, 5);
  // Crew assignments + active employees for the assignment picker. Both
  // small lookups so we fetch unconditionally — gated visually below by
  // role.
  const [crewAssignments, allEmployees] = await Promise.all([
    listAssignmentsForProject(project.id),
    listEmployees(companyId),
  ]);
  const activeEmployees = allEmployees.filter((e) => e.active);
  // Bucket assignments into today / upcoming / past so the admin sees
  // the most relevant first.
  const todayIso = new Date().toISOString().slice(0, 10);
  const projectDocuments = await listProjectDocuments(companyId, project.id);
  const recentDocuments = projectDocuments.slice(0, 5);
  const recentDocCoNumbers = await getChangeOrderNumbers(
    companyId,
    recentDocuments
      .map((d) => d.changeOrderId)
      .filter((v): v is string => typeof v === 'string'),
  );
  const invoices = await listInvoicesForProject(project.id);
  const creditMemos = await listCreditMemosForProject(companyId, project.id);
  const totalCreditAmount = creditMemos.reduce(
    (acc, cm) => acc + Number(cm.amount),
    0,
  );
  const openCreditAmount = creditMemos.reduce(
    (acc, cm) => acc + (Number(cm.amount) - Number(cm.appliedAmount)),
    0,
  );
  const voidInvoiceCount = invoices.filter((i) => i.status === 'void').length;
  const visibleInvoices = showVoid
    ? invoices
    : invoices.filter((i) => i.status !== 'void');
  const invoiceSummary = await computeProjectInvoiceSummary(project.id);
  const invoicesBySource = await computeProjectInvoicesByContractSource(project.id);
  // Remaining billable on this job = revised contract (net) − net billed,
  // PLUS the outstanding retainage balance (held retention is billed-but-held,
  // so it stays "to bill/collect" until released), netting back scope-reduction
  // refunds. Same math as the dashboard's collective "Remaining billable" so
  // the per-job number ties to the total.
  const refundsCreditedForProject =
    (await getContractReductionRefundByProjectMap(companyId)).get(project.id) ??
    0;
  const remainingBillable = computeRemainingBillable(
    parseMoney(project.contractValue),
    invoiceSummary.totalInvoicedNet,
    refundsCreditedForProject,
    invoiceSummary.retainageBalance,
  );
  const coById = new Map(changeOrders.map((co) => [co.id, co]));
  const projectPayments = (
    await Promise.all(
      invoices.map(async (inv) => {
        const payments = await getInvoicePayments(inv.id);
        return payments.map((p) => ({
          ...p,
          invoiceNumber: inv.number,
          invoiceVoid: inv.status === 'void',
        }));
      }),
    )
  )
    .flat()
    .sort((a, b) => b.paidDate.localeCompare(a.paidDate));
  const voidPaymentCount = projectPayments.filter((p) => p.invoiceVoid).length;
  const visiblePayments = showVoid
    ? projectPayments
    : projectPayments.filter((p) => !p.invoiceVoid);

  const address = [
    project.jobsiteAddressLine1,
    project.jobsiteCity,
    project.jobsiteState,
    project.jobsitePostalCode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <Breadcrumbs
        items={[
          { href: '/projects', label: 'Projects' },
          { label: project.name },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {returnTo && (
            <Link href={returnTo as never}>
              <Button size="sm">← Back to {returnToLabel(returnTo)}</Button>
            </Link>
          )}
          <Link href="/projects">
            <Button variant="outline" size="sm">
              ← Back to Projects
            </Button>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {allowCreate && (
            <Link href={{ pathname: `/projects/${project.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          )}
          {allowCreate && <ArchiveProjectForm id={project.id} />}
          {allowCreate && (
            <Link href="/projects/new">
              <Button size="sm">New Project</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            <Link href={`/customers/${customer.id}`} className="hover:underline">
              {customer.name}
            </Link>
            {address && <span className="text-slate-400">·</span>}
            {address && <span>{address}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {project.projectType === 'service' && (
            <Badge tone="blue">Service / T&amp;M</Badge>
          )}
          <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
        </div>
      </div>

      {project.projectType === 'service' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span className="font-medium">Time &amp; Materials job.</span> Billed from
          labor hours + materials, not a fixed contract.{' '}
          {project.tmLaborBillRate && Number(project.tmLaborBillRate) > 0
            ? `Default labor bill rate ${formatMoney(project.tmLaborBillRate)}/hr.`
            : 'No default labor bill rate set.'}{' '}
          {project.tmMaterialMarkupPct && Number(project.tmMaterialMarkupPct) > 0
            ? `Material markup ${project.tmMaterialMarkupPct}%.`
            : ''}
        </div>
      )}

      {/* Quick navigation */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 flex flex-wrap gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-500 self-center mr-2">
          Jump to
        </span>
        <Link href="/estimates">
          <Button size="sm" variant="outline">
            Estimates →
          </Button>
        </Link>
        <Link href="/proposals">
          <Button size="sm" variant="outline">
            Proposals →
          </Button>
        </Link>
        <Link href="/change-orders">
          <Button size="sm" variant="outline">
            Change Orders →
          </Button>
        </Link>
        <Link href="/purchase-orders">
          <Button size="sm" variant="outline">
            Purchase Orders →
          </Button>
        </Link>
        <Link href="/invoices">
          <Button size="sm" variant="outline">
            Invoices →
          </Button>
        </Link>
        <Link href={`/job-costing/${project.id}`}>
          <Button size="sm" variant="outline">
            Job Costing →
          </Button>
        </Link>
        <Link href={`/projects/${project.id}/daily-reports`}>
          <Button size="sm" variant="outline">
            Daily Reports →
          </Button>
        </Link>
        <Link href={{ pathname: `/projects/${project.id}/documents` }}>
          <Button size="sm" variant="outline">
            Documents →
          </Button>
        </Link>
      </div>

      {/* KPI cards: contract roll-up + projected GP */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPI label="Contract Value" value={formatMoney(project.originalContractValue)} />
        <KPI
          label="Approved Change Orders"
          value={formatMoney(project.totalChangeOrders)}
        />
        <KPI
          label="Revised Contract"
          value={formatMoney(project.contractValue)}
          valueClassName="text-slate-900 font-semibold"
        />
        <KPI
          label="Landed Cost (all-in)"
          value={fin ? formatMoney(fin.landedCostTotal) : '—'}
          sub={fin && fin.landedCostSurcharge > 0
            ? `+${formatMoney(fin.landedCostSurcharge)} surcharge`
            : undefined}
        />
        <KPI
          label="Projected Gross Profit"
          value={fin ? formatMoney(fin.projectedGrossProfit) : '—'}
          sub={fin && project.contractValue && Number(project.contractValue) > 0
            ? `${fin.projectedGrossMarginPct.toFixed(1)}% margin`
            : undefined}
          valueClassName={
            fin && fin.projectedGrossProfit < 0
              ? 'text-red-600'
              : fin && fin.projectedGrossProfit > 0
                ? 'text-emerald-700'
                : 'text-slate-900'
          }
        />
      </div>

      {/* Self-heal: recompute totalChangeOrders + contractValue from the
          actual approved-CO sum. Use when the running balance drifted. */}
      {allowCreate && (
        <div className="flex items-start justify-end">
          <RecomputeTotalsButton projectId={project.id} />
        </div>
      )}

      {/* Job Costing snapshot — links to the full per-project page */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Job costing</CardTitle>
            <Link href={`/job-costing/${project.id}`}>
              <Button size="sm">Open Job Costing →</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
            <Stat label="Estimated cost" value={fin ? formatMoney(fin.estimatedCost) : '—'} />
            <Stat label="Committed (POs)" value={fin ? formatMoney(fin.committedCost) : '—'} />
            <Stat label="Actual to date" value={fin ? formatMoney(fin.actualCost) : '—'} />
            <Stat
              label="Cost to complete"
              value={fin ? formatMoney(fin.costToComplete) : '—'}
              valueClassName={
                fin && fin.costToComplete > 0 ? 'text-slate-900' : 'text-slate-400'
              }
            />
            <Stat
              label="Projected final"
              value={fin ? formatMoney(fin.projectedFinalCost) : '—'}
              valueClassName="text-slate-900 font-semibold"
            />
            <Stat
              label="Open commitments"
              value={fin ? formatMoney(fin.openCommitments) : '—'}
              valueClassName={
                fin && fin.openCommitments > 0 ? 'text-amber-700' : 'text-slate-400'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Workflow status counts */}
      {(() => {
        const counts = computeProjectStatusCounts({
          estimates,
          proposals,
          changeOrders,
          purchaseOrders,
          invoices,
        });
        return (
          <Card>
            <CardHeader>
              <CardTitle>Workflow status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                <Stat
                  label="Pending COs"
                  value={String(counts.pendingChangeOrders)}
                  valueClassName={counts.pendingChangeOrders > 0 ? 'text-amber-700' : 'text-slate-900'}
                />
                <Stat
                  label="Open POs"
                  value={String(counts.openPurchaseOrders)}
                  valueClassName={counts.openPurchaseOrders > 0 ? 'text-amber-700' : 'text-slate-900'}
                />
                <Stat
                  label="Unpaid invoices"
                  value={String(counts.unpaidInvoices)}
                  valueClassName={counts.unpaidInvoices > 0 ? 'text-amber-700' : 'text-slate-900'}
                />
                <Stat
                  label="Overdue invoices"
                  value={String(counts.overdueInvoices)}
                  valueClassName={counts.overdueInvoices > 0 ? 'text-red-600' : 'text-slate-900'}
                />
                <Stat
                  label="Estimates in review"
                  value={String(counts.internalReviewEstimates)}
                  valueClassName={counts.internalReviewEstimates > 0 ? 'text-amber-700' : 'text-slate-900'}
                />
                <Stat
                  label="Proposals sent"
                  value={String(counts.sentProposals)}
                  valueClassName={counts.sentProposals > 0 ? 'text-blue-700' : 'text-slate-900'}
                />
                <Stat
                  label="Approved estimates"
                  value={String(counts.approvedEstimates)}
                  valueClassName="text-emerald-700"
                />
                <Stat
                  label="Approved proposals"
                  value={String(counts.approvedProposals)}
                  valueClassName="text-emerald-700"
                />
                <Stat
                  label="Approved COs"
                  value={String(counts.approvedChangeOrders)}
                  valueClassName="text-emerald-700"
                />
                <Stat
                  label="Closed POs"
                  value={String(counts.closedPurchaseOrders)}
                  valueClassName="text-slate-700"
                />
                <Stat
                  label="Paid invoices"
                  value={String(counts.paidInvoices)}
                  valueClassName="text-emerald-700"
                />
                <Stat
                  label="Draft estimates"
                  value={String(counts.draftEstimates)}
                  valueClassName="text-slate-600"
                />
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Estimates */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Estimates ({estimates.length})</CardTitle>
            <div className="flex items-center gap-2">
              {allowCreateDocument && (
                <Link
                  href={{
                    pathname: `/projects/${project.id}/documents`,
                    query: { category: 'estimate' },
                  }}
                >
                  <Button size="sm" variant="outline">
                    Upload file
                  </Button>
                </Link>
              )}
              {allowCreateEstimate && (
                <Link href="/estimates/new">
                  <Button size="sm" variant="outline">
                    + New estimate
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {estimates.length === 0 ? (
            <Empty>No estimates for this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {estimates.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {e.number}
                    </TableCell>
                    <TableCell>
                      <Badge tone={EST_STATUS_TONE[e.status]}>
                        {EST_STATUS_LABEL[e.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(e.subtotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(e.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={{ pathname: `/estimates/${e.id}`, query: { from: 'project' } }}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Proposals */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Proposals ({proposals.length})</CardTitle>
            <div className="flex items-center gap-2">
              {allowCreateDocument && (
                <Link
                  href={{
                    pathname: `/projects/${project.id}/documents`,
                    query: { category: 'proposal' },
                  }}
                >
                  <Button size="sm" variant="outline">
                    Upload file
                  </Button>
                </Link>
              )}
              {allowCreateProposal && (
                <Link href="/proposals/new">
                  <Button size="sm" variant="outline">
                    + New proposal
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {proposals.length === 0 ? (
            <Empty>No proposals for this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {p.number}
                    </TableCell>
                    <TableCell>
                      <Badge tone={PROP_STATUS_TONE[p.status]}>
                        {PROP_STATUS_LABEL[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">{p.proposalDate ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{p.expiryDate ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(p.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={{ pathname: `/proposals/${p.id}`, query: { from: 'project' } }}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Change Orders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Change Orders ({changeOrders.length})</CardTitle>
            <div className="flex items-center gap-2">
              {allowCreateDocument && (
                <Link
                  href={{
                    pathname: `/projects/${project.id}/documents`,
                    query: { category: 'change_order' },
                  }}
                >
                  <Button size="sm" variant="outline">
                    Upload file
                  </Button>
                </Link>
              )}
              {allowCreateCO && (
                <Link href="/change-orders/new">
                  <Button size="sm" variant="outline">
                    + New change order
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {changeOrders.length === 0 ? (
            <Empty>No change orders for this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeOrders.map((co) => (
                  <TableRow key={co.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {co.number}
                    </TableCell>
                    <TableCell>
                      <Badge tone={CO_STATUS_TONE[co.status]}>
                        {CO_STATUS_LABEL[co.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">{co.submittedAt ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{co.approvedAt ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {co.scheduleImpactDays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(co.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={{ pathname: `/change-orders/${co.id}`, query: { from: 'project' } }}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Purchase Orders */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Purchase Orders ({purchaseOrders.length})</CardTitle>
            {allowCreatePO && (
              <Link href="/purchase-orders/new">
                <Button size="sm" variant="outline">
                  + New PO
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {purchaseOrders.length === 0 ? (
            <Empty>No purchase orders for this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order date</TableHead>
                  <TableHead>Landed cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrdersWithVendor.map(({ po, vendor }) => {
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
                      <TableCell className="text-slate-600">
                        {po.issueDate ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs">
                        {po.landedCostEntryId ? (
                          <Link
                            href={{ pathname: `/landed-cost/${po.landedCostEntryId}`, query: { from: 'project' } }}
                            className="hover:underline"
                          >
                            linked
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(po.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={{ pathname: `/purchase-orders/${po.id}`, query: { from: 'project' } }}>
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

      {/* Invoicing summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoicing summary</CardTitle>
            {allowCreateInvoice && (
              <Link href="/invoices/new">
                <Button size="sm" variant="outline">
                  + New invoice
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
            <Stat
              label="Remaining billable (net)"
              value={formatMoney(remainingBillable)}
              valueClassName={
                remainingBillable > 0
                  ? 'text-blue-700'
                  : remainingBillable < 0
                    ? 'text-amber-700'
                    : 'text-slate-900'
              }
              sub={`revised contract ${formatMoney(parseMoney(project.contractValue))} − net billed${
                invoiceSummary.retainageBalance > 0
                  ? ` + ${formatMoney(invoiceSummary.retainageBalance)} retainage held`
                  : ''
              }${
                refundsCreditedForProject > 0
                  ? ` (less ${formatMoney(refundsCreditedForProject)} refunded)`
                  : ''
              }`}
            />
            <Stat
              label="Revenue invoiced (net)"
              value={formatMoney(invoiceSummary.totalInvoicedNet)}
              sub={`VAT ${formatMoney(invoiceSummary.totalInvoicedVat)} · gross ${formatMoney(invoiceSummary.totalInvoiced)}`}
            />
            <Stat
              label="Revenue collected (net)"
              value={formatMoney(invoiceSummary.totalPaidNet)}
              valueClassName="text-emerald-700"
              sub={`VAT collected ${formatMoney(invoiceSummary.totalPaidVat)} · gross ${formatMoney(invoiceSummary.totalPaid)}`}
            />
            <Stat
              label="Outstanding (gross)"
              value={formatMoney(invoiceSummary.outstandingBalance)}
              valueClassName={
                invoiceSummary.outstandingBalance > 0
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }
              sub={`net ${formatMoney(invoiceSummary.outstandingBalanceNet)} · VAT ${formatMoney(invoiceSummary.outstandingBalanceVat)}`}
            />
            <Stat
              label="Retainage held"
              value={formatMoney(invoiceSummary.retainageHeld)}
            />
          </div>

          {/* Breakdown by contract source — base contract vs each linked
              change order. Only renders when the project actually has CO
              billings or COs on record, so single-contract projects keep
              the simpler one-block summary. Invoices without a linked CO
              roll up into the "Base contract" bucket. */}
          {(invoicesBySource.byChangeOrder.length > 0 ||
            changeOrders.length > 0) && (
            <div className="border-t border-slate-200 pt-4">
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                Billed by contract source
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Retainage held</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-slate-900">
                      Base contract
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {formatMoney(project.originalContractValue)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {invoicesBySource.base.invoiceCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(invoicesBySource.base.totalInvoiced)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">
                      {formatMoney(invoicesBySource.base.totalPaid)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        invoicesBySource.base.outstandingBalance > 0
                          ? 'text-amber-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {formatMoney(invoicesBySource.base.outstandingBalance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(invoicesBySource.base.retainageHeld)}
                    </TableCell>
                  </TableRow>
                  {invoicesBySource.byChangeOrder.map((bucket) => {
                    const co = bucket.changeOrderId
                      ? coById.get(bucket.changeOrderId)
                      : undefined;
                    const coLabel = co
                      ? `${co.number} — ${co.description.slice(0, 40)}`
                      : 'Linked change order';
                    return (
                      <TableRow key={bucket.changeOrderId ?? 'co-unknown'}>
                        <TableCell className="font-medium text-slate-900">
                          {co ? (
                            <Link
                              href={{ pathname: `/change-orders/${co.id}`, query: { from: 'project' } }}
                              className="hover:underline"
                            >
                              {coLabel}
                            </Link>
                          ) : (
                            coLabel
                          )}
                          {co && (
                            <span className="ml-2 text-xs font-normal text-slate-500">
                              {formatMoney(co.total)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {bucket.invoiceCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(bucket.totalInvoiced)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {formatMoney(bucket.totalPaid)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            bucket.outstandingBalance > 0
                              ? 'text-amber-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {formatMoney(bucket.outstandingBalance)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {formatMoney(bucket.retainageHeld)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* List approved COs that have ZERO billings — so the user
                      sees them as ready-to-invoice rather than missing. */}
                  {changeOrders
                    .filter(
                      (co) =>
                        co.status === 'approved' &&
                        !invoicesBySource.byChangeOrder.some(
                          (b) => b.changeOrderId === co.id,
                        ),
                    )
                    .map((co) => (
                      <TableRow key={`unbilled-${co.id}`} className="opacity-70">
                        <TableCell className="font-medium text-slate-900">
                          <Link
                            href={{ pathname: `/change-orders/${co.id}`, query: { from: 'project' } }}
                            className="hover:underline"
                          >
                            {co.number} — {co.description.slice(0, 40)}
                          </Link>
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            {formatMoney(co.total)} · not yet billed
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-400">
                          0
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-400">
                          {formatMoney(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-400">
                          {formatMoney(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-400">
                          {formatMoney(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-400">
                          {formatMoney(0)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Retainage summary */}
      {(invoiceSummary.retainageHeld > 0 ||
        invoiceSummary.retainageReleased > 0) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Retainage summary</CardTitle>
              <Link href="/retainage">
                <Button size="sm" variant="outline">
                  Open Retainage →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Stat
                label="Retainage held"
                value={formatMoney(invoiceSummary.retainageHeld)}
              />
              <Stat
                label="Retainage released"
                value={formatMoney(invoiceSummary.retainageReleased)}
                valueClassName="text-emerald-700"
              />
              <Stat
                label="Retainage balance"
                value={formatMoney(invoiceSummary.retainageBalance)}
                valueClassName={
                  invoiceSummary.retainageBalance > 0
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoices for this project */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>
              Invoices ({visibleInvoices.length})
              {!showVoid && voidInvoiceCount > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  · {voidInvoiceCount} void hidden
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {allowCreateDocument && (
                <Link
                  href={{
                    pathname: `/projects/${project.id}/documents`,
                    query: { category: 'invoice' },
                  }}
                >
                  <Button size="sm" variant="outline">
                    Upload file
                  </Button>
                </Link>
              )}
              {voidInvoiceCount > 0 && (
                <Link
                  href={{
                    pathname: `/projects/${project.id}`,
                    query: showVoid ? {} : { showVoid: '1' },
                  }}
                >
                  <Button size="sm" variant="outline">
                    {showVoid ? 'Hide void' : 'Show void'}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visibleInvoices.length === 0 ? (
            <Empty>No invoices for this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInvoices.map((inv) => {
                  const balance =
                    Number(inv.total) - Number(inv.amountPaid);
                  const billingLabel = inv.billingType.replace('_', ' ');
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {inv.number}
                      </TableCell>
                      <TableCell className="text-slate-600 capitalize">
                        {billingLabel}
                      </TableCell>
                      <TableCell className="text-slate-600 capitalize">
                        {inv.status}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {inv.invoiceDate}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(inv.total)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          balance <= 0 ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {formatMoney(balance)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={{ pathname: `/invoices/${inv.id}`, query: { from: 'project' } }}>
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

      {/* Credit memos for this project */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>
              Credit memos ({creditMemos.length})
              {openCreditAmount > 0 && (
                <span className="ml-2 text-xs font-normal text-amber-700">
                  · {formatMoney(openCreditAmount)} open
                </span>
              )}
            </CardTitle>
            {allowCreateInvoice && (
              <IssueCreditMemoDialog
                scope={{
                  customerId: customer.id,
                  customerName: customer.name,
                  projectId: project.id,
                  projectName: project.name,
                  invoiceId: null,
                  invoiceNumber: null,
                  suggestDeductCO: true,
                }}
                triggerLabel="Issue credit memo"
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {creditMemos.length === 0 ? (
            <Empty>No credit memos on this project.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditMemos.map((cm) => {
                  const open = Number(cm.amount) - Number(cm.appliedAmount);
                  return (
                    <TableRow key={cm.id}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={{ pathname: `/credit-memos/${cm.id}`, query: { from: 'project' } }}
                          className="text-blue-600 hover:underline"
                        >
                          {cm.number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {cm.issueDate}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs capitalize">
                        {cm.status.replace('_', ' ')}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs">
                        {cm.reason}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(cm.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(cm.appliedAmount)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          open > 0 ? 'text-amber-700 font-medium' : 'text-slate-400'
                        }`}
                      >
                        {formatMoney(open)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader>
          <CardTitle>
            Payment history ({visiblePayments.length})
            {!showVoid && voidPaymentCount > 0 && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                · {voidPaymentCount} on void invoices hidden
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visiblePayments.length === 0 ? (
            <Empty>No payments recorded against this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePayments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {p.paymentNumber || '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{p.paidDate}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {p.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-slate-600 capitalize">
                      {(p.method ?? '—').replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-slate-600 font-mono text-xs">
                      {p.reference ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 capitalize">
                      {p.status}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(p.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={{ pathname: `/payments/${p.id}`, query: { from: 'project' } }}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Landed Cost / Shipping */}
      <Card>
        <CardHeader>
          <CardTitle>Landed Cost / Shipping ({landedCosts.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {landedCosts.length === 0 ? (
            <Empty>No landed-cost entries for this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead className="text-right">CIF</TableHead>
                  <TableHead className="text-right">Total landed</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {landedCosts.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium text-slate-900">
                      {l.name}
                    </TableCell>
                    <TableCell className="text-slate-600">{l.carrier ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(l.cif)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(l.totalLandedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(l.perUnitCost)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={{ pathname: `/landed-cost/${l.id}`, query: { from: 'project' } }}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Crew assignments — who's on this job which day. Feeds the
          field app's /field/jobs "today's assignments" view. */}
      <CrewAssignmentsPanel
        projectId={project.id}
        assignments={crewAssignments.map((a) => ({
          id: a.id,
          employeeId: a.employeeId,
          assignedDate: a.assignedDate,
          roleLabel: a.roleLabel,
          notes: a.notes,
        }))}
        employees={activeEmployees.map((e) => ({
          id: e.id,
          label: `${e.firstName} ${e.lastName}`.trim(),
        }))}
        defaultDate={todayIso}
        canManage={allowCreate}
      />

      {/* Daily Reports */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Daily Reports ({dailyReports.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Link href={`/projects/${project.id}/daily-reports`}>
                <Button size="sm" variant="outline">
                  View all →
                </Button>
              </Link>
              {allowCreateDailyReport && (
                <Link href={`/projects/${project.id}/daily-reports/new`}>
                  <Button size="sm" variant="outline">
                    + New daily report
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentDailyReports.length === 0 ? (
            <Empty>No daily reports for this project yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Foreman</TableHead>
                  <TableHead className="text-right"># Men</TableHead>
                  <TableHead>Weather</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDailyReports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-slate-900">
                      {r.reportDate}
                    </TableCell>
                    <TableCell>
                      <Badge tone={DR_STATUS_TONE[r.status]}>
                        {DR_STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {r.foremanName ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-700">
                      {r.menOnSite}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {[r.weatherCondition, r.weatherTemperatureF ? `${r.weatherTemperatureF}°F` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/projects/${project.id}/daily-reports/${r.id}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Documents ({projectDocuments.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Link href={{ pathname: `/projects/${project.id}/documents` }}>
                <Button size="sm" variant="outline">
                  {allowCreateDocument ? 'View / upload →' : 'View all →'}
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentDocuments.length === 0 ? (
            <Empty>
              No documents uploaded for this project yet.
              {allowCreateDocument &&
                ' Open the Documents page to add proposals, contracts, drawings, permits, photos, and more.'}
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDocuments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium text-slate-900 break-all">
                      {d.fileName}
                      {d.changeOrderId && recentDocCoNumbers.get(d.changeOrderId) && (
                        <Link
                          href={`/change-orders/${d.changeOrderId}`}
                          className="mt-0.5 inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          ↳ {recentDocCoNumbers.get(d.changeOrderId)}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs">
                        {DOCUMENT_CATEGORY_LABEL[d.category]}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span
                        className={
                          d.visibleToClient
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }
                      >
                        {d.visibleToClient ? '✓ Client' : 'Internal'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {d.uploadedAt instanceof Date
                        ? d.uploadedAt.toLocaleDateString()
                        : new Date(d.uploadedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`/projects/${project.id}/documents/${d.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="sm" variant="outline">
                          Download
                        </Button>
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Schedule + jobsite + notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Customer" value={customer.name} />
            <Row label="Status" value={STATUS_LABEL[project.status]} />
            <Row
              label="Original contract"
              value={formatMoney(project.originalContractValue)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobsite & schedule</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Address" value={address || '—'} />
            <Row label="Start date" value={project.startDate ?? '—'} />
            <Row label="Target completion" value={project.targetCompletionDate ?? '—'} />
            <Row label="Actual completion" value={project.actualCompletionDate ?? '—'} />
          </CardContent>
        </Card>
      </div>

      {project.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{project.notes}</CardContent>
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

function Stat({
  label,
  value,
  valueClassName,
  sub,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          valueClassName ?? 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{sub}</p>}
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

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-sm text-slate-500">{children}</div>;
}
