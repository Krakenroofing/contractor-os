// Server-only aggregator for the global dashboard.
//
// Pulls everything from the in-memory mock store (company-scoped) and produces
// one big DashboardData object that the server page renders verbatim. Pure
// functions live in @/lib/status-machine — this module only owns the
// store-bound aggregation logic.

import 'server-only';
import { listInvoices } from '@/lib/data/invoices';
import { listInvoicePaymentsForCompany } from '@/lib/data/invoice-payments';
import { listChangeOrders } from '@/lib/data/change-orders';
import { listProposals } from '@/lib/data/proposals';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { listProjects } from '@/lib/data/projects';
import { add, parseMoney, round2, subtract } from '@/lib/money';
import { normalizeStatus } from '@/lib/status-machine';
import {
  buildAgingRowsForCompany,
  calcCashCollectedThisMonth,
  summarizeAging,
} from '@/modules/accounts-receivable/lib/ar';
import {
  buildRetainageRowsForCompany,
  summarizeRetainage,
} from '@/modules/retainage/lib/retainage';
import { listAllProjectFinancials } from '@/modules/job-costing/lib/financials';
import {
  computeInvoiceFinancials,
  groupPaymentsByInvoice,
} from '@/modules/invoices/lib/financials';

// ===== Types =====

export type DashboardKPIs = {
  // Headline totals
  activeProjects: number;
  totalContractValue: number;
  approvedChangeOrders: number;
  approvedChangeOrderTotal: number;
  totalInvoiced: number;
  totalPaid: number;
  outstandingAR: number;
  retainageHeld: number;
  committedPurchaseOrders: number;
  committedPurchaseOrderTotal: number;
  // Profitability
  projectedGrossProfit: number;
  projectedGrossMarginPct: number;
  // Cash this month (bonus, free from AR module)
  cashCollectedThisMonth: number;
};

export type AlertItem = {
  href: string;
  label: string;
};

export type DashboardAlerts = {
  overdueInvoices: { count: number; total: number; items: AlertItem[] };
  pendingChangeOrders: { count: number; total: number; items: AlertItem[] };
  posNotReceived: { count: number; total: number; items: AlertItem[] };
  retainageOverdue: { count: number; total: number; items: AlertItem[] };
  proposalsExpiringSoon: { count: number; items: AlertItem[] };
};

export type DashboardData = {
  kpis: DashboardKPIs;
  alerts: DashboardAlerts;
  asOf: Date;
};

// ===== Helpers =====

function isActiveProject(status: string): boolean {
  return status === 'in_progress' || status === 'won';
}

function parseISO(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

function todayUTC(asOf: Date): Date {
  return new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
}

function daysBetween(fromISO: string, asOf: Date): number {
  const today = todayUTC(asOf);
  const from = parseISO(fromISO);
  return Math.floor((today.getTime() - from.getTime()) / 86_400_000);
}

// ===== Builder =====

export async function buildDashboardData(
  companyId: string,
  asOf: Date = new Date(),
): Promise<DashboardData> {
  // ---- Projects ----
  const projects = await listProjects(companyId);
  const activeProjects = projects.filter((p) => isActiveProject(p.status)).length;
  const totalContractValue = projects.reduce(
    (acc, p) => add(acc, parseMoney(p.contractValue)),
    0,
  );

  // ---- Change Orders ----
  const changeOrders = await listChangeOrders(companyId);
  let approvedCOCount = 0;
  let approvedCOTotal = 0;
  let pendingCOCount = 0;
  let pendingCOTotal = 0;
  const pendingCOItems: AlertItem[] = [];
  for (const co of changeOrders) {
    const c = normalizeStatus('change_order', co.status);
    if (c === 'approved') {
      approvedCOCount += 1;
      approvedCOTotal = add(approvedCOTotal, parseMoney(co.total));
    } else if (c === 'submitted' || c === 'draft') {
      pendingCOCount += 1;
      pendingCOTotal = add(pendingCOTotal, parseMoney(co.total));
      if (pendingCOItems.length < 5) {
        pendingCOItems.push({
          href: `/change-orders/${co.id}`,
          label: `${co.number} — ${co.description.slice(0, 60)}`,
        });
      }
    }
  }

  // ---- Invoices + AR ----
  // Compute totals directly from payment rows so a stale `amount_paid` cache
  // (which can drift when a manual "Mark Paid" status flip lands without a
  // matching payment row) cannot lie to the dashboard. Source of truth is the
  // invoice_payments table, joined per-invoice.
  const invoices = await listInvoices(companyId);
  const allPayments = await listInvoicePaymentsForCompany(companyId);
  const paymentsByInvoice = groupPaymentsByInvoice(allPayments);
  let totalInvoiced = 0;
  let totalPaid = 0;
  let outstandingAR = 0;
  for (const inv of invoices) {
    const c = normalizeStatus('invoice', inv.status);
    if (c === 'void') continue;
    const fin = computeInvoiceFinancials(inv, paymentsByInvoice.get(inv.id) ?? []);
    totalInvoiced = add(totalInvoiced, fin.total);
    totalPaid = add(totalPaid, fin.paid);
    outstandingAR = add(outstandingAR, fin.balance);
  }
  // outstandingAR equals subtract(totalInvoiced, totalPaid) under the
  // invariant — kept as a separate sum so over-payments on one invoice
  // never silently offset under-payments on another.

  const agingRows = await buildAgingRowsForCompany(companyId, asOf);
  const agingSummary = summarizeAging(agingRows);
  const overdueRows = agingRows.filter((r) => r.daysOverdue > 0);
  const overdueTotal = overdueRows.reduce((acc, r) => add(acc, r.balance), 0);
  const overdueItems: AlertItem[] = overdueRows.slice(0, 5).map((r) => ({
    href: `/invoices/${r.invoiceId}`,
    label: `${r.invoiceNumber} — ${r.customerName} · ${r.daysOverdue}d late`,
  }));

  const cashCollectedThisMonth = await calcCashCollectedThisMonth(companyId, asOf);

  // ---- Retainage ----
  const retainageRows = await buildRetainageRowsForCompany(companyId, asOf);
  const retainageSummary = summarizeRetainage(retainageRows);
  const retainageOverdueRows = retainageRows.filter((r) => r.status === 'overdue');
  const retainageOverdueItems: AlertItem[] = retainageOverdueRows
    .slice(0, 5)
    .map((r) => ({
      href: `/retainage/${r.invoiceId}/release`,
      label: `${r.invoiceNumber} — ${r.customerName} · ${
        r.daysUntilRelease !== null ? `${Math.abs(r.daysUntilRelease)}d late` : 'overdue'
      }`,
    }));

  // ---- Purchase Orders ----
  const purchaseOrders = await listPurchaseOrders(companyId);
  let committedCount = 0;
  let committedTotal = 0;
  let posNotReceivedCount = 0;
  let posNotReceivedTotal = 0;
  const posNotReceivedItems: AlertItem[] = [];
  for (const po of purchaseOrders) {
    const c = normalizeStatus('purchase_order', po.status);
    if (c === 'void' || c === 'closed') continue;
    committedCount += 1;
    committedTotal = add(committedTotal, parseMoney(po.total));
    if (c === 'issued' || c === 'partially_received' || c === 'draft') {
      posNotReceivedCount += 1;
      posNotReceivedTotal = add(posNotReceivedTotal, parseMoney(po.total));
      if (posNotReceivedItems.length < 5) {
        posNotReceivedItems.push({
          href: `/purchase-orders/${po.id}`,
          label: `${po.number} — ${c === 'partially_received' ? 'partial' : c}`,
        });
      }
    }
  }

  // ---- Proposals expiring soon (canonical "sent" status, expiry within 7d) ----
  const proposals = await listProposals(companyId);
  const horizonDays = 7;
  const proposalsExpiringSoon: AlertItem[] = [];
  let proposalsExpiringSoonCount = 0;
  for (const p of proposals) {
    const c = normalizeStatus('proposal', p.status);
    if (c !== 'sent') continue;
    if (!p.expiryDate) continue;
    const daysUntilExpiry = -daysBetween(p.expiryDate, asOf);
    if (daysUntilExpiry <= horizonDays) {
      proposalsExpiringSoonCount += 1;
      if (proposalsExpiringSoon.length < 5) {
        const label =
          daysUntilExpiry < 0
            ? `${p.number} — expired ${Math.abs(daysUntilExpiry)}d ago`
            : daysUntilExpiry === 0
              ? `${p.number} — expires today`
              : `${p.number} — expires in ${daysUntilExpiry}d`;
        proposalsExpiringSoon.push({
          href: `/proposals/${p.id}`,
          label,
        });
      }
    }
  }

  // ---- Projected gross profit / margin (uses job-costing per-project rollup) ----
  const allFinancials = await listAllProjectFinancials(companyId);
  const activeFinancials = allFinancials.filter((f) =>
    isActiveProject(
      projects.find((p) => p.id === f.projectId)?.status ?? 'lead',
    ),
  );
  // Use revisedContractValue (contract + approved COs) as "revenue".
  const projectedRevenue = activeFinancials.reduce(
    (acc, f) => add(acc, f.revisedContractValue),
    0,
  );
  const projectedCost = activeFinancials.reduce(
    (acc, f) => add(acc, f.estimatedCost),
    0,
  );
  const projectedGrossProfit = subtract(projectedRevenue, projectedCost);
  const projectedGrossMarginPct =
    projectedRevenue > 0
      ? round2((projectedGrossProfit / projectedRevenue) * 100)
      : 0;

  return {
    asOf,
    kpis: {
      activeProjects,
      totalContractValue: round2(totalContractValue),
      approvedChangeOrders: approvedCOCount,
      approvedChangeOrderTotal: round2(approvedCOTotal),
      totalInvoiced: round2(totalInvoiced),
      totalPaid: round2(totalPaid),
      outstandingAR: round2(outstandingAR),
      retainageHeld: round2(retainageSummary.outstanding),
      committedPurchaseOrders: committedCount,
      committedPurchaseOrderTotal: round2(committedTotal),
      projectedGrossProfit: round2(projectedGrossProfit),
      projectedGrossMarginPct,
      cashCollectedThisMonth,
    },
    alerts: {
      overdueInvoices: {
        count: agingSummary.overdueCount,
        total: round2(overdueTotal),
        items: overdueItems,
      },
      pendingChangeOrders: {
        count: pendingCOCount,
        total: round2(pendingCOTotal),
        items: pendingCOItems,
      },
      posNotReceived: {
        count: posNotReceivedCount,
        total: round2(posNotReceivedTotal),
        items: posNotReceivedItems,
      },
      retainageOverdue: {
        count: retainageSummary.overdueCount,
        total: round2(retainageSummary.overdue),
        items: retainageOverdueItems,
      },
      proposalsExpiringSoon: {
        count: proposalsExpiringSoonCount,
        items: proposalsExpiringSoon,
      },
    },
  };
}
