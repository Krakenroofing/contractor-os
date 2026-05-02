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
import { getActiveCompanyId } from '@/lib/active-company';
import { formatMoney } from '@/lib/money';
import { listLandedCostsForProject } from '@/lib/data/landed-costs';
import { getVendor } from '@/lib/data/vendors';
import {
  computeCategoryTotals,
  computeProjectCostCodeBreakdown,
  computeProjectFinancials,
  listProjectPurchaseOrders,
} from '@/modules/job-costing/lib/financials';
import {
  STATUS_LABEL as PO_STATUS_LABEL,
  STATUS_TONE as PO_STATUS_TONE,
} from '@/modules/purchase-orders/schema';
import type { CostCode, Project } from '@/db/schema';

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

const CATEGORY_LABEL: Record<CostCode['category'], string> = {
  labor: 'Labor',
  material: 'Material',
  equipment: 'Equipment',
  subcontract: 'Subcontract',
  other: 'Other',
};

const CATEGORY_TONE: Record<CostCode['category'], 'amber' | 'blue' | 'slate' | 'green'> = {
  labor: 'amber',
  material: 'blue',
  equipment: 'slate',
  subcontract: 'green',
  other: 'slate',
};

export default async function JobCostingProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const companyId = await getActiveCompanyId();
  const fin = await computeProjectFinancials(companyId, projectId);
  if (!fin) notFound();

  const breakdown = await computeProjectCostCodeBreakdown(companyId, projectId);
  const categoryTotals = computeCategoryTotals(breakdown);
  const projectPOs = await listProjectPurchaseOrders(projectId);
  const projectPOsWithVendor = await Promise.all(
    projectPOs.map(async (po) => ({
      po,
      vendor: await getVendor(companyId, po.vendorId),
    })),
  );
  const projectLandedCosts = await listLandedCostsForProject(projectId);

  return (
    <div className="p-8 space-y-6 max-w-[100rem]">
      <Breadcrumbs
        items={[
          { href: '/job-costing', label: 'Job Costing' },
          { label: fin.projectNumber },
        ]}
      />

      <div className="flex items-center justify-between">
        <Link href="/job-costing">
          <Button variant="outline" size="sm">
            ← Back to Job Costing
          </Button>
        </Link>
        <Link href={`/projects/${fin.projectId}`}>
          <Button variant="ghost" size="sm">
            View Project →
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-slate-500">{fin.projectNumber}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{fin.projectName}</h1>
          <p className="text-sm text-slate-600 mt-1">{fin.customerName}</p>
        </div>
        <Badge tone={STATUS_TONE[fin.status]}>{STATUS_LABEL[fin.status]}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Contract" value={formatMoney(fin.contractValue)} />
        <KPI
          label="Approved CO"
          value={formatMoney(fin.approvedChangeOrders)}
        />
        <KPI label="Revised contract" value={formatMoney(fin.revisedContractValue)} />
        <KPI
          label="Projected GP"
          value={formatMoney(fin.projectedGrossProfit)}
          sub={
            fin.revisedContractValue > 0
              ? `${fin.projectedGrossMarginPct.toFixed(1)}% margin`
              : '—'
          }
          valueClassName={
            fin.projectedGrossProfit < 0
              ? 'text-red-600'
              : fin.projectedGrossProfit > 0
                ? 'text-emerald-700'
                : 'text-slate-900'
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Estimate vs. actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <SummaryStat label="Estimated cost" value={formatMoney(fin.estimatedCost)} />
            <SummaryStat
              label="Committed (POs)"
              value={formatMoney(fin.committedCost)}
            />
            <SummaryStat label="Actual to date" value={formatMoney(fin.actualCost)} />
            <SummaryStat
              label="Landed cost (all-in)"
              value={formatMoney(fin.landedCostTotal)}
            />
            <SummaryStat
              label="Landed-cost surcharge"
              value={formatMoney(fin.landedCostSurcharge)}
              valueClassName={fin.landedCostSurcharge > 0 ? 'text-amber-700' : 'text-slate-900'}
            />
          </div>
        </CardContent>
      </Card>

      {projectLandedCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Landed cost / shipping ({projectLandedCosts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead className="text-right">CIF</TableHead>
                  <TableHead className="text-right">Duty + VAT</TableHead>
                  <TableHead className="text-right">Total landed</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectLandedCosts.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium text-slate-900">
                      {l.name}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {l.carrier ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(l.cif)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(Number(l.dutyAmount) + Number(l.vatAmount))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(l.totalLandedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(l.perUnitCost)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/landed-cost/${l.id}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cost by category</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {categoryTotals.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No cost activity yet on this project.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Budgeted</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryTotals.map((c) => {
                  const variance = c.budgeted - c.actual;
                  return (
                    <TableRow key={c.category}>
                      <TableCell>
                        <Badge tone={CATEGORY_TONE[c.category]}>
                          {CATEGORY_LABEL[c.category]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(c.budgeted)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(c.committed)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(c.actual)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          variance < 0 ? 'text-red-600' : 'text-emerald-700'
                        }`}
                      >
                        {formatMoney(variance)}
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
          <CardTitle>Cost code breakdown ({breakdown.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {breakdown.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No estimate or PO activity yet — once an estimate is approved or a PO is
              issued, codes appear here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Budgeted</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map((row) => (
                  <TableRow key={row.costCodeId}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      <Link
                        href={`/cost-codes/${row.costCodeId}`}
                        className="hover:underline"
                      >
                        {row.code}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-900">{row.description}</TableCell>
                    <TableCell>
                      <Badge tone={CATEGORY_TONE[row.category]}>
                        {CATEGORY_LABEL[row.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.budgeted)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(row.committed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.actual)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        row.variance < 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatMoney(row.variance)}
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
          <CardTitle>Purchase order commitments ({projectPOs.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {projectPOs.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No POs against this project yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order date</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectPOsWithVendor.map(({ po, vendor }) => {
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {po.number}
                      </TableCell>
                      <TableCell className="font-medium text-slate-900">
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

function SummaryStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
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
    </div>
  );
}
