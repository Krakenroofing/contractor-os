import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inArray } from 'drizzle-orm';
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
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { getDb, isDatabaseConfigured } from '@/db';
import { users } from '@/db/schema';
import { listLandedCostsForProject } from '@/lib/data/landed-costs';
import { listCostCodes } from '@/lib/data/cost-codes';
import { getVendor, listVendors } from '@/lib/data/vendors';
import {
  listJobCostEntriesForProject,
  sumActualByCostTypeForProject,
} from '@/lib/data/job-cost-entries';
import {
  buildForecastRollup,
  computeCategoryTotals,
  computeProjectCostCodeBreakdown,
  computeProjectFinancials,
  listProjectPurchaseOrders,
} from '@/modules/job-costing/lib/financials';
import { CostEntryTabs } from '@/modules/job-costing/components/cost-entry-tabs';
import {
  CostEntriesList,
  type CostEntryRow,
} from '@/modules/job-costing/components/cost-entries-list';
import { ForecastList } from '@/modules/job-costing/components/forecast-list';
import {
  JOB_COST_TYPE_LABEL,
  JOB_COST_TYPE_TONE,
  type JobCostType,
} from '@/modules/job-costing/schema';
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
  const role = await getActiveRole();
  const allowCreateCost = canCreate(role, 'job_costing');
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

  // Cost-entry data for the new Phase 1 section
  const allCostCodes = await listCostCodes(companyId);
  const activeCostCodes = allCostCodes
    .filter((c) => c.isActive)
    .map((c) => ({
      id: c.id,
      code: c.code,
      description: c.description,
      division: c.division ?? null,
    }));
  const allVendors = (await listVendors(companyId)).map((v) => ({
    id: v.id,
    name: v.name,
  }));
  const costEntries = await listJobCostEntriesForProject(companyId, projectId);
  const costEntryUserIds = Array.from(
    new Set(
      costEntries
        .map((e) => e.createdByUserId)
        .filter((v): v is string => typeof v === 'string'),
    ),
  );
  const userNameMap = new Map<string, string>();
  if (costEntryUserIds.length > 0 && isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, costEntryUserIds));
    for (const r of rows) userNameMap.set(r.id, r.name || r.email);
  }
  const costCodeLookup = new Map(allCostCodes.map((c) => [c.id, c]));
  const vendorLookup = new Map(allVendors.map((v) => [v.id, v.name]));
  const costEntryRows: CostEntryRow[] = costEntries.map((e) => {
    const code = costCodeLookup.get(e.costCodeId);
    return {
      id: e.id,
      entryDate: e.entryDate,
      costCode: code?.code ?? '—',
      costCodeDescription: code?.description ?? '',
      costType: e.costType as JobCostType,
      vendorName: e.vendorId ? vendorLookup.get(e.vendorId) ?? null : null,
      description: e.description,
      quantity: e.quantity,
      unitCost: e.unitCost,
      amount: e.amount,
      isBillable: e.isBillable,
      markupPercent: e.markupPercent,
      createdByName: e.createdByUserId
        ? userNameMap.get(e.createdByUserId) ?? null
        : null,
    };
  });

  const actualByCostType = await sumActualByCostTypeForProject(companyId, projectId);
  const totalManualActual = actualByCostType.reduce((a, r) => a + r.actual, 0);

  // Phase 2: forecast roll-up for the per-cost-code table.
  const forecastRollup = await buildForecastRollup(companyId, projectId);

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

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI label="Contract" value={formatMoney(fin.contractValue)} />
        <KPI
          label="Approved CO"
          value={formatMoney(fin.approvedChangeOrders)}
        />
        <KPI label="Revised contract" value={formatMoney(fin.revisedContractValue)} />
        <KPI label="Actual to date" value={formatMoney(fin.actualCost)} />
        <KPI
          label="Cost to complete"
          value={formatMoney(fin.costToComplete)}
          sub={fin.costToComplete > 0 ? 'Forecast' : 'No forecast yet'}
          valueClassName={fin.costToComplete > 0 ? 'text-slate-900' : 'text-slate-400'}
        />
        <KPI
          label="Projected GP"
          value={formatMoney(fin.projectedGrossProfit)}
          sub={
            fin.revisedContractValue > 0
              ? `${fin.projectedGrossMarginPct.toFixed(1)}% margin · final ${formatMoney(fin.projectedFinalCost)}`
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

      {/* Phase 1: manual cost entries — the new job-cost ledger */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Cost entries ({costEntryRows.length})</CardTitle>
            <div className="text-xs text-slate-500 tabular-nums">
              Manual actuals: {formatMoney(totalManualActual)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {actualByCostType.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actualByCostType.map((r) => (
                <span
                  key={r.costType}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-50 ring-1 ring-slate-200 px-3 py-1 text-xs"
                >
                  <Badge tone={JOB_COST_TYPE_TONE[r.costType as JobCostType]}>
                    {JOB_COST_TYPE_LABEL[r.costType as JobCostType]}
                  </Badge>
                  <span className="tabular-nums font-medium text-slate-900">
                    {formatMoney(r.actual)}
                  </span>
                </span>
              ))}
            </div>
          )}
          {allowCreateCost && (
            <CostEntryTabs
              projectId={fin.projectId}
              costCodes={activeCostCodes}
              vendors={allVendors}
            />
          )}
          <CostEntriesList
            projectId={fin.projectId}
            entries={costEntryRows}
            allowEdit={allowCreateCost}
          />
        </CardContent>
      </Card>

      {/* Phase 2: Cost-to-complete forecast → Projected Final Cost */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Cost to complete forecast</CardTitle>
            <div className="text-xs text-slate-500 tabular-nums">
              Projected final: {formatMoney(fin.projectedFinalCost)}
              {fin.costToComplete > 0 && (
                <span className="ml-2 text-slate-400">
                  (Actual {formatMoney(fin.actualCost)} + CTC{' '}
                  {formatMoney(fin.costToComplete)})
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ForecastList
            projectId={fin.projectId}
            forecasts={forecastRollup}
            costCodes={activeCostCodes}
            allowEdit={allowCreateCost}
          />
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
