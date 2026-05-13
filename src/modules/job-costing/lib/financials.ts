import 'server-only';
import {
  listJobCostEntriesForProject as listMockJobCostEntriesForProject,
  listLaborEntriesForProject,
} from '@/lib/mock-store';
import {
  sumActualByCostCodeForProject,
  sumManualActualForProject,
} from '@/lib/data/job-cost-entries';
import {
  listJobCostForecastsForProject,
  sumCostToCompleteForProject,
} from '@/lib/data/job-cost-forecasts';
import { isDatabaseConfigured } from '@/db';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { getEstimateLineItems, listEstimatesForProject } from '@/lib/data/estimates';
import { getPurchaseOrderLines, listPurchaseOrdersForProject } from '@/lib/data/purchase-orders';
import { listLandedCostsForProject } from '@/lib/data/landed-costs';
import { getCustomer } from '@/lib/data/customers';
import { getProject, listProjects } from '@/lib/data/projects';
import { getActiveCompanyId } from '@/lib/active-company';
import {
  add,
  calcMargin,
  multiply,
  parseMoney,
  round2,
  subtract,
} from '@/lib/money';
import type { CostCode, Project, PurchaseOrder } from '@/db/schema';

export type ProjectFinancials = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  customerName: string;
  status: Project['status'];
  contractValue: number;
  approvedChangeOrders: number;
  revisedContractValue: number;
  estimatedCost: number;
  committedCost: number;
  actualCost: number;
  // Phase 2: forecast roll-up. When forecasts exist they replace the old
  // estimate-anchored GP math with a forward-looking projection.
  costToComplete: number;
  projectedFinalCost: number;
  landedCostTotal: number;
  landedCostSurcharge: number;
  projectedGrossProfit: number;
  projectedGrossMarginPct: number;
};

export type CostCodeBreakdownRow = {
  costCodeId: string;
  code: string;
  description: string;
  category: CostCode['category'];
  budgeted: number;
  committed: number;
  actual: number;
  variance: number;
};

export type CategoryTotals = {
  category: CostCode['category'];
  budgeted: number;
  committed: number;
  actual: number;
};

async function primaryEstimateForProject(companyId: string, projectId: string) {
  const estimates = await listEstimatesForProject(companyId, projectId);
  if (estimates.length === 0) return null;
  // Prefer approved, then sent, then most recent draft.
  const priority: Record<string, number> = { approved: 0, sent: 1, draft: 2, rejected: 3 };
  const sorted = [...estimates].sort(
    (a, b) =>
      (priority[a.status] ?? 99) - (priority[b.status] ?? 99) ||
      +b.createdAt - +a.createdAt,
  );
  return sorted[0];
}

export async function computeProjectFinancials(
  companyId: string,
  projectId: string,
): Promise<ProjectFinancials | null> {
  const project = await getProject(companyId, projectId);
  if (!project) return null;
  const customer = await getCustomer(companyId, project.customerId);

  const originalContract = parseMoney(project.originalContractValue);
  const approvedChangeOrders = parseMoney(project.totalChangeOrders);
  const revisedContractValue = parseMoney(project.contractValue);

  const primaryEstimate = await primaryEstimateForProject(companyId, projectId);
  const estimatedCost = primaryEstimate ? parseMoney(primaryEstimate.subtotal) : 0;

  const projectPOs = (await listPurchaseOrdersForProject(projectId)).filter(
    (p) => p.status !== 'void',
  );

  const committedCost = projectPOs.reduce(
    (acc, po) => add(acc, parseMoney(po.total)),
    0,
  );

  let actualFromPOs = 0;
  for (const po of projectPOs) {
    const lines = await getPurchaseOrderLines(po.id);
    for (const line of lines) {
      actualFromPOs = add(
        actualFromPOs,
        multiply(Number(line.quantityReceived), Number(line.unitCost)),
      );
    }
  }

  const labor = listLaborEntriesForProject(projectId);
  const actualLabor = labor.reduce((acc, l) => add(acc, parseMoney(l.amount)), 0);

  // Manual job-cost entries. In real-DB mode we read from job_cost_entries
  // (post-Phase-1 of the Job Costing rebuild). Demo mode still reads the
  // in-memory mock-store (which is always empty today).
  const actualManual = isDatabaseConfigured()
    ? await sumManualActualForProject(companyId, projectId)
    : listMockJobCostEntriesForProject(projectId).reduce(
        (acc, e) => add(acc, parseMoney(e.amount)),
        0,
      );

  // Landed cost surcharge = total all-in landed cost minus the supplier
  // material we've already captured in PO line totals — avoids double-counting.
  const landedCosts = await listLandedCostsForProject(projectId);
  const landedCostTotal = landedCosts.reduce(
    (a, l) => add(a, parseMoney(l.totalLandedCost)),
    0,
  );
  const landedCostMaterial = landedCosts.reduce(
    (a, l) => add(a, parseMoney(l.materialCost)),
    0,
  );
  const landedCostSurcharge = Math.max(0, subtract(landedCostTotal, landedCostMaterial));

  const actualCost = add(actualFromPOs, actualLabor, actualManual, landedCostSurcharge);

  // Phase 2: Projected Final Cost = Actual To Date + Cost to Complete.
  // Cost to Complete is summed from job_cost_forecasts. When no forecasts
  // exist the projection falls back to the legacy estimate-based math so
  // the page doesn't suddenly show zeros after a deploy.
  const costToComplete = isDatabaseConfigured()
    ? await sumCostToCompleteForProject(companyId, projectId)
    : 0;
  const hasForecast = costToComplete > 0;
  const projectedFinalCost = hasForecast
    ? add(actualCost, costToComplete)
    : add(estimatedCost, landedCostSurcharge);

  const margin = calcMargin(revisedContractValue, projectedFinalCost);
  const projectedGrossProfit = margin.profit;
  const projectedGrossMarginPct = margin.marginPct;

  return {
    projectId: project.id,
    projectNumber: project.number,
    projectName: project.name,
    customerName: customer?.name ?? 'Unknown customer',
    status: project.status,
    contractValue: originalContract,
    approvedChangeOrders,
    revisedContractValue,
    estimatedCost,
    committedCost,
    actualCost,
    costToComplete,
    projectedFinalCost,
    landedCostTotal,
    landedCostSurcharge,
    projectedGrossProfit,
    projectedGrossMarginPct,
  };
}

export async function listAllProjectFinancials(
  companyId: string,
): Promise<ProjectFinancials[]> {
  const projects = await listProjects(companyId);
  const financials = await Promise.all(
    projects.map((p) => computeProjectFinancials(companyId, p.id)),
  );
  return financials.filter((x): x is ProjectFinancials => x !== null);
}

export async function computeProjectCostCodeBreakdown(
  companyId: string,
  projectId: string,
): Promise<CostCodeBreakdownRow[]> {
  const aggregates = new Map<
    string,
    { budgeted: number; committed: number; actual: number }
  >();

  const ensure = (codeId: string) => {
    if (!aggregates.has(codeId)) {
      aggregates.set(codeId, { budgeted: 0, committed: 0, actual: 0 });
    }
    return aggregates.get(codeId)!;
  };

  const primaryEstimate = await primaryEstimateForProject(companyId, projectId);
  if (primaryEstimate) {
    const lines = await getEstimateLineItems(primaryEstimate.id);
    for (const line of lines) {
      const cost = multiply(Number(line.quantity), Number(line.unitCost));
      const agg = ensure(line.costCodeId);
      agg.budgeted = add(agg.budgeted, cost);
    }
  }

  const projectPOs = (await listPurchaseOrdersForProject(projectId)).filter(
    (p) => p.status !== 'void',
  );
  for (const po of projectPOs) {
    const lines = await getPurchaseOrderLines(po.id);
    for (const line of lines) {
      const agg = ensure(line.costCodeId);
      agg.committed = add(agg.committed, parseMoney(line.lineTotal));
      agg.actual = add(
        agg.actual,
        multiply(Number(line.quantityReceived), Number(line.unitCost)),
      );
    }
  }

  for (const l of listLaborEntriesForProject(projectId)) {
    const agg = ensure(l.costCodeId);
    agg.actual = add(agg.actual, parseMoney(l.amount));
  }

  // Manual job-cost actuals by cost code. DB-backed in real mode; in-memory
  // mock entries are always empty so the loop is effectively skipped there.
  if (isDatabaseConfigured()) {
    const manualByCode = await sumActualByCostCodeForProject(companyId, projectId);
    for (const m of manualByCode) {
      const agg = ensure(m.costCodeId);
      agg.actual = add(agg.actual, m.actual);
    }
  } else {
    for (const e of listMockJobCostEntriesForProject(projectId)) {
      const agg = ensure(e.costCodeId);
      agg.actual = add(agg.actual, parseMoney(e.amount));
    }
  }

  const codeMap = await loadCostCodeMap(companyId, Array.from(aggregates.keys()));

  const rows: CostCodeBreakdownRow[] = [];
  for (const [costCodeId, agg] of aggregates) {
    const code = codeMap.get(costCodeId);
    if (!code) continue;
    rows.push({
      costCodeId,
      code: code.code,
      description: code.description,
      category: code.category,
      budgeted: round2(agg.budgeted),
      committed: round2(agg.committed),
      actual: round2(agg.actual),
      variance: subtract(agg.budgeted, agg.actual),
    });
  }

  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export function computeCategoryTotals(rows: CostCodeBreakdownRow[]): CategoryTotals[] {
  const categories: CostCode['category'][] = [
    'labor',
    'material',
    'equipment',
    'subcontract',
    'other',
  ];
  return categories
    .map((category) => {
      const inCat = rows.filter((r) => r.category === category);
      return {
        category,
        budgeted: inCat.reduce((a, r) => add(a, r.budgeted), 0),
        committed: inCat.reduce((a, r) => add(a, r.committed), 0),
        actual: inCat.reduce((a, r) => add(a, r.actual), 0),
      };
    })
    .filter((c) => c.budgeted > 0 || c.committed > 0 || c.actual > 0);
}

export async function listProjectPurchaseOrders(projectId: string): Promise<PurchaseOrder[]> {
  return listPurchaseOrdersForProject(projectId);
}

// Phase 2: shape forecast rows for the page — joins each forecast with
// budgeted (from primary estimate) and actual-to-date (from job_cost_entries)
// so the table can show projected-final + variance vs budget.
export type ForecastRollupRow = {
  id: string;
  costCodeId: string;
  costCode: string;
  costCodeDescription: string;
  actualToDate: number;
  costToComplete: number;
  projectedFinal: number;
  budgeted: number;
  notes: string | null;
  riskFlag: boolean;
};

export async function buildForecastRollup(
  companyId: string,
  projectId: string,
): Promise<ForecastRollupRow[]> {
  const forecasts = await listJobCostForecastsForProject(companyId, projectId);
  if (forecasts.length === 0) return [];

  const breakdown = await computeProjectCostCodeBreakdown(companyId, projectId);
  const byCode = new Map(breakdown.map((b) => [b.costCodeId, b]));

  const codeMap = await loadCostCodeMap(
    companyId,
    forecasts.map((f) => f.costCodeId),
  );

  return forecasts
    .map((f) => {
      const breakdownRow = byCode.get(f.costCodeId);
      const code = codeMap.get(f.costCodeId);
      const ctc = Number(f.costToComplete);
      const actual = breakdownRow?.actual ?? 0;
      const budgeted = breakdownRow?.budgeted ?? 0;
      return {
        id: f.id,
        costCodeId: f.costCodeId,
        costCode: code?.code ?? '—',
        costCodeDescription: code?.description ?? '',
        actualToDate: actual,
        costToComplete: ctc,
        projectedFinal: actual + ctc,
        budgeted,
        notes: f.notes,
        riskFlag: f.riskFlag,
      };
    })
    .sort((a, b) => a.costCode.localeCompare(b.costCode));
}
