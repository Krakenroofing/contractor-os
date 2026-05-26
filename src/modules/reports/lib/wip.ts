// Work-in-Progress (WIP) report.
//
// The classic surety / banker / PM view of active construction contracts:
// for each project show contract value, cost-to-date, % complete (cost
// basis), revenue earned (% complete × contract), billed-to-date, the
// over/(under) billing position, and projected gross profit.
//
// Most of the heavy lifting already exists in computeProjectFinancials
// (Job Costing module) — it returns contract / cost-to-date / projected
// final cost / projected GP. This module layers the WIP-specific math
// on top: percent complete, revenue earned, and the billing variance.

import 'server-only';
import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { invoices } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { listAllProjectFinancials } from '@/modules/job-costing/lib/financials';
import type { ProjectFinancials } from '@/modules/job-costing/lib/financials';
import type { ReportFilters } from './filters';

export type WipProjectRow = {
  projectId: string;
  projectName: string;
  customerName: string;
  status: ProjectFinancials['status'];
  contractValue: number; // revised contract = original + approved COs
  costToDate: number;
  projectedFinalCost: number;
  /** 0–100 (raw value can exceed 100 when cost overruns projection — kept
   *  uncapped here so over-run is visible; UI may clamp for display). */
  percentComplete: number;
  revenueEarned: number;
  billedToDate: number;
  invoiceCount: number;
  /** Positive = under-billed (work done > billed). Negative = over-billed
   *  (billed ahead of work — common, healthy for cashflow). */
  overUnderBilled: number;
  projectedGrossProfit: number;
  projectedGrossMarginPct: number;
};

export type WipSummary = {
  projectCount: number;
  contractValue: number;
  costToDate: number;
  projectedFinalCost: number;
  revenueEarned: number;
  billedToDate: number;
  overUnderBilled: number;
  projectedGrossProfit: number;
  weightedMarginPct: number; // grossProfit / contract — weighted across all
  underBilledCount: number;
  overBilledCount: number;
};

export type WipReport = {
  rows: WipProjectRow[];
  summary: WipSummary;
  asOf: Date;
};

/**
 * Sum invoice subtotal (ex-VAT) per project, filtered by date range and
 * status not in (draft, void). Returns Map<projectId, { total, count }>.
 */
async function sumInvoicedByProject(
  companyId: string,
  filters: ReportFilters,
  projectIds: string[],
): Promise<Map<string, { total: number; count: number }>> {
  const out = new Map<string, { total: number; count: number }>();
  if (!isDatabaseConfigured() || projectIds.length === 0) return out;
  const db = getDb()!;
  const conds = [
    eq(invoices.companyId, companyId),
    ne(invoices.status, 'draft'),
    ne(invoices.status, 'void'),
    inArray(invoices.projectId, projectIds),
  ];
  if (filters.from) conds.push(gte(invoices.invoiceDate, filters.from));
  if (filters.to) conds.push(lte(invoices.invoiceDate, filters.to));
  const rows = await db
    .select({
      projectId: invoices.projectId,
      total: sql<string>`COALESCE(SUM(${invoices.subtotal}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(invoices)
    .where(and(...conds))
    .groupBy(invoices.projectId);
  for (const r of rows) {
    out.set(r.projectId, {
      total: Number(r.total),
      count: Number(r.count ?? 0),
    });
  }
  return out;
}

export async function buildWipReport(
  companyId: string,
  filters: ReportFilters,
): Promise<WipReport> {
  const asOf = new Date();

  // Per-project financial rollup (contract / cost-to-date / projected GP).
  const allFinancials = await listAllProjectFinancials(companyId);

  // Apply the optional project filter — WIP for a single project is
  // exactly the row that project would contribute to the company-wide
  // version, just isolated.
  const filtered = filters.projectId
    ? allFinancials.filter((f) => f.projectId === filters.projectId)
    : allFinancials;

  // Skip projects with zero revised contract value — a not-yet-quoted
  // lead with no contract is noise on this report. The PM workflow
  // captures those elsewhere (the project list).
  const eligible = filtered.filter((f) => f.revisedContractValue > 0);

  const billedMap = await sumInvoicedByProject(
    companyId,
    filters,
    eligible.map((f) => f.projectId),
  );

  const rows: WipProjectRow[] = eligible.map((f) => {
    const billed = billedMap.get(f.projectId);
    const billedToDate = billed?.total ?? 0;
    const invoiceCount = billed?.count ?? 0;

    // % complete on a COST basis: cost-to-date / projected-final-cost.
    // When projected is zero (no estimate, no actuals, no forecast),
    // there's no signal — treat as 0% rather than dividing by zero.
    const percentComplete =
      f.projectedFinalCost > 0
        ? Math.round((f.actualCost / f.projectedFinalCost) * 10000) / 100
        : 0;
    // Cap the multiplier at 1.0 for revenue-earned math. Over 100%
    // complete (cost overrun) doesn't mean we've earned > contract;
    // earned can't exceed contract. The raw percentComplete value is
    // kept above for the UI so the operator can see the overrun.
    const earnedMultiplier = Math.min(percentComplete / 100, 1);
    const revenueEarned =
      Math.round(f.revisedContractValue * earnedMultiplier * 100) / 100;
    const overUnderBilled = Math.round((revenueEarned - billedToDate) * 100) / 100;

    return {
      projectId: f.projectId,
      projectName: f.projectName,
      customerName: f.customerName,
      status: f.status,
      contractValue: f.revisedContractValue,
      costToDate: f.actualCost,
      projectedFinalCost: f.projectedFinalCost,
      percentComplete,
      revenueEarned,
      billedToDate,
      invoiceCount,
      overUnderBilled,
      projectedGrossProfit: f.projectedGrossProfit,
      projectedGrossMarginPct: f.projectedGrossMarginPct,
    };
  });

  // Sort: open / active projects first (largest contract first), then by
  // contract size. PMs scan top-down so the most "current" work surfaces.
  rows.sort((a, b) => {
    const aActive =
      a.status === 'in_progress' || a.status === 'won' ? 0 : 1;
    const bActive =
      b.status === 'in_progress' || b.status === 'won' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.contractValue - a.contractValue;
  });

  // Summary: simple sums + a weighted margin across all projects.
  const contractValue = rows.reduce((acc, r) => acc + r.contractValue, 0);
  const costToDate = rows.reduce((acc, r) => acc + r.costToDate, 0);
  const projectedFinalCost = rows.reduce((acc, r) => acc + r.projectedFinalCost, 0);
  const revenueEarned = rows.reduce((acc, r) => acc + r.revenueEarned, 0);
  const billedToDate = rows.reduce((acc, r) => acc + r.billedToDate, 0);
  const overUnderBilled = rows.reduce((acc, r) => acc + r.overUnderBilled, 0);
  const projectedGrossProfit = rows.reduce((acc, r) => acc + r.projectedGrossProfit, 0);
  const weightedMarginPct =
    contractValue > 0
      ? Math.round((projectedGrossProfit / contractValue) * 1000) / 10
      : 0;
  const underBilledCount = rows.filter((r) => r.overUnderBilled > 0.5).length;
  const overBilledCount = rows.filter((r) => r.overUnderBilled < -0.5).length;

  return {
    rows,
    summary: {
      projectCount: rows.length,
      contractValue: Math.round(contractValue * 100) / 100,
      costToDate: Math.round(costToDate * 100) / 100,
      projectedFinalCost: Math.round(projectedFinalCost * 100) / 100,
      revenueEarned: Math.round(revenueEarned * 100) / 100,
      billedToDate: Math.round(billedToDate * 100) / 100,
      overUnderBilled: Math.round(overUnderBilled * 100) / 100,
      projectedGrossProfit: Math.round(projectedGrossProfit * 100) / 100,
      weightedMarginPct,
      underBilledCount,
      overBilledCount,
    },
    asOf,
  };
}
