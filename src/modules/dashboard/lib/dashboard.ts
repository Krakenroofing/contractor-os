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

  // Invoiced totals — split so the dashboard can label revenue (ex-VAT)
  // separately from gross billed and VAT-on-behalf-of-government.
  //   totalInvoicedNet   = sum(invoice.subtotal) — accrual revenue
  //   totalInvoicedVAT   = sum(invoice.taxAmount) — VAT liability we owe
  //   totalInvoicedGross = sum(invoice.total) — gross billed (= net + VAT − retainage)
  // `totalInvoiced` retained as an alias for `totalInvoicedGross` to avoid
  // breaking call sites that read it.
  totalInvoiced: number;
  totalInvoicedNet: number;
  totalInvoicedVAT: number;
  totalInvoicedGross: number;

  // Paid totals — same shape. Paid amounts are split proportionally by each
  // invoice's tax/total ratio: payment×(tax/total) is VAT collected,
  // remainder is cash revenue.
  totalPaid: number;
  totalPaidNet: number;
  totalPaidVAT: number;
  totalPaidGross: number;

  outstandingAR: number;
  retainageHeld: number;
  committedPurchaseOrders: number;
  committedPurchaseOrderTotal: number;
  // Profitability
  projectedGrossProfit: number;
  projectedGrossMarginPct: number;
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

export type QuarterRevenueRow = {
  /** 'YYYY-Qn' — used as a stable React key + URL filter param later. */
  quarterKey: string;
  /** 'Q1 2025' — display label. */
  label: string;
  /** Sum of invoice subtotals (ex-VAT) for invoices dated in this quarter. */
  revenueNet: number;
  /** Sum of invoice taxAmount for invoices dated in this quarter. */
  vat: number;
  /** Sum of invoice.total (gross). */
  gross: number;
  invoiceCount: number;
};

export type DashboardData = {
  kpis: DashboardKPIs;
  alerts: DashboardAlerts;
  /**
   * Per-quarter revenue breakdown — every quarter from Q1 2025 through the
   * current quarter (inclusive). Empty quarters are present with zeros so
   * the UI renders the full timeline.
   */
  revenueByQuarter: QuarterRevenueRow[];
  asOf: Date;
};

// ===== Helpers =====

/** Q1 2025 — fixed start of the revenue-by-quarter timeline shown on the
 *  dashboard. Could later become configurable per-company. */
const REVENUE_TIMELINE_START_YEAR = 2025;
const REVENUE_TIMELINE_START_QUARTER = 1;

function quarterOf(date: { year: number; month: number }): number {
  return Math.min(4, Math.max(1, Math.ceil(date.month / 3)));
}

function quarterKey(year: number, q: number): string {
  return `${year}-Q${q}`;
}

function quarterLabel(year: number, q: number): string {
  return `Q${q} ${year}`;
}

/** Enumerate quarters from (startYear, startQ) up through (endDate)'s
 *  quarter, inclusive. */
function enumerateQuartersUpTo(
  startYear: number,
  startQ: number,
  endDate: Date,
): Array<{ key: string; label: string; year: number; q: number }> {
  const endYear = endDate.getUTCFullYear();
  const endQ = quarterOf({
    year: endYear,
    month: endDate.getUTCMonth() + 1,
  });
  const out: Array<{ key: string; label: string; year: number; q: number }> = [];
  let y = startYear;
  let q = startQ;
  // Cap at 100 iterations as a safety net — 25 years of quarters.
  for (let i = 0; i < 100; i++) {
    if (y > endYear || (y === endYear && q > endQ)) break;
    out.push({ key: quarterKey(y, q), label: quarterLabel(y, q), year: y, q });
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

function quarterKeyForInvoiceDate(iso: string): string {
  // iso is YYYY-MM-DD; slice safely.
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const q = quarterOf({ year, month });
  return quarterKey(year, q);
}

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
  let totalInvoicedGross = 0;
  let totalInvoicedNet = 0;
  let totalInvoicedVAT = 0;
  let totalPaidGross = 0;
  let totalPaidNet = 0;
  let totalPaidVAT = 0;
  let outstandingAR = 0;
  // Accumulator for the per-quarter timeline. Keyed by `YYYY-Qn`; only
  // populated from non-void invoices, dropped if the invoice predates the
  // timeline start (Q1 2025 today).
  const byQuarterAcc = new Map<
    string,
    { revenueNet: number; vat: number; gross: number; invoiceCount: number }
  >();
  for (const inv of invoices) {
    const c = normalizeStatus('invoice', inv.status);
    if (c === 'void') continue;
    const fin = computeInvoiceFinancials(inv, paymentsByInvoice.get(inv.id) ?? []);
    const subtotal = parseMoney(inv.subtotal);
    const tax = parseMoney(inv.taxAmount);
    // Proportional VAT split on payments — when an invoice is half-paid,
    // half of its VAT has been received. Falls back to "all net" when the
    // invoice has no VAT or zero total (avoids div-by-zero).
    const totalWithTax = subtotal + tax;
    const vatShare = totalWithTax > 0 ? tax / totalWithTax : 0;
    const paidVat = fin.paid * vatShare;
    const paidNet = fin.paid - paidVat;
    totalInvoicedGross = add(totalInvoicedGross, fin.total);
    totalInvoicedNet = add(totalInvoicedNet, subtotal);
    totalInvoicedVAT = add(totalInvoicedVAT, tax);
    totalPaidGross = add(totalPaidGross, fin.paid);
    totalPaidNet = add(totalPaidNet, paidNet);
    totalPaidVAT = add(totalPaidVAT, paidVat);
    outstandingAR = add(outstandingAR, fin.balance);

    // Quarterly rollup. Bucket by invoiceDate — same source of truth as
    // the VAT report (accrual basis), so revenue lines up exactly.
    const qKey = quarterKeyForInvoiceDate(inv.invoiceDate);
    const acc = byQuarterAcc.get(qKey) ?? {
      revenueNet: 0,
      vat: 0,
      gross: 0,
      invoiceCount: 0,
    };
    acc.revenueNet = add(acc.revenueNet, subtotal);
    acc.vat = add(acc.vat, tax);
    acc.gross = add(acc.gross, fin.total);
    acc.invoiceCount += 1;
    byQuarterAcc.set(qKey, acc);
  }
  // Stitch the timeline: Q1 2025 → current quarter, filling empties with 0s
  // so the dashboard always renders the full sequence the user wants to
  // see while backfilling.
  const timelineQuarters = enumerateQuartersUpTo(
    REVENUE_TIMELINE_START_YEAR,
    REVENUE_TIMELINE_START_QUARTER,
    asOf,
  );
  const revenueByQuarter: QuarterRevenueRow[] = timelineQuarters.map((q) => {
    const acc = byQuarterAcc.get(q.key);
    return {
      quarterKey: q.key,
      label: q.label,
      revenueNet: round2(acc?.revenueNet ?? 0),
      vat: round2(acc?.vat ?? 0),
      gross: round2(acc?.gross ?? 0),
      invoiceCount: acc?.invoiceCount ?? 0,
    };
  });
  // outstandingAR equals subtract(totalInvoicedGross, totalPaidGross) under
  // the invariant — kept as a separate sum so over-payments on one invoice
  // never silently offset under-payments on another.

  const agingRows = await buildAgingRowsForCompany(companyId, asOf);
  const agingSummary = summarizeAging(agingRows);
  const overdueRows = agingRows.filter((r) => r.daysOverdue > 0);
  const overdueTotal = overdueRows.reduce((acc, r) => add(acc, r.balance), 0);
  const overdueItems: AlertItem[] = overdueRows.slice(0, 5).map((r) => ({
    href: `/invoices/${r.invoiceId}`,
    label: `${r.invoiceNumber} — ${r.customerName} · ${r.daysOverdue}d late`,
  }));

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
    revenueByQuarter,
    kpis: {
      activeProjects,
      totalContractValue: round2(totalContractValue),
      approvedChangeOrders: approvedCOCount,
      approvedChangeOrderTotal: round2(approvedCOTotal),
      totalInvoiced: round2(totalInvoicedGross),
      totalInvoicedNet: round2(totalInvoicedNet),
      totalInvoicedVAT: round2(totalInvoicedVAT),
      totalInvoicedGross: round2(totalInvoicedGross),
      totalPaid: round2(totalPaidGross),
      totalPaidNet: round2(totalPaidNet),
      totalPaidVAT: round2(totalPaidVAT),
      totalPaidGross: round2(totalPaidGross),
      outstandingAR: round2(outstandingAR),
      retainageHeld: round2(retainageSummary.outstanding),
      committedPurchaseOrders: committedCount,
      committedPurchaseOrderTotal: round2(committedTotal),
      projectedGrossProfit: round2(projectedGrossProfit),
      projectedGrossMarginPct,
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
