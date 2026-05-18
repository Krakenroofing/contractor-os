// Server-only builders for each of the 7 report types. Each returns a typed
// data structure with summary KPIs and detailed rows; the page renders the
// HTML view and the CSV route handler renders the same data into a flat
// CSV. Both consume this module — never duplicate the math.

import 'server-only';
import { listCustomers } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import {
  computeProjectInvoicesByContractSource,
  getInvoiceLineItems,
  listInvoices,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
import { listReceipts } from '@/lib/data/receipts';
import {
  listPurchaseOrders,
  getPurchaseOrderLines,
} from '@/lib/data/purchase-orders';
import { listLandedCosts } from '@/lib/data/landed-costs';
import { listChangeOrders } from '@/lib/data/change-orders';
import { getVendor, listVendors } from '@/lib/data/vendors';
// listVendors is consumed by the VAT-quarterly expenses pane (Phase B).
import {
  computeProjectFinancials,
  computeProjectCostCodeBreakdown,
  type ProjectFinancials,
  type CostCodeBreakdownRow,
} from '@/modules/job-costing/lib/financials';
import {
  buildAgingRowsForCompany,
  summarizeAging,
  type AgingRow,
  type AgingSummary,
  AGING_BUCKETS,
  BUCKET_LABEL,
  type AgingBucket,
} from '@/modules/accounts-receivable/lib/ar';
import { add, parseMoney, round2, subtract } from '@/lib/money';
import { normalizeStatus } from '@/lib/status-machine';
import type { ReportFilters } from './filters';
import { isInRange } from './filters';

// ===== VAT Quarterly Report =====
//
// Accrual-basis VAT liability with two sides:
//
//   OUTPUT VAT — what we owe the government. Every non-void / non-draft
//   invoice contributes vat = subtotal × company.vatRatePercent / 100 to the
//   quarter of its invoiceDate.
//
//   INPUT VAT — what we can reclaim from the government. Every posted
//   receipt with `vat_recoverable=true` contributes its receipt.vatAmount
//   to the quarter the receipt was dated.
//
//   NET VAT DUE = output − input. Positive means we pay the government.
//
// When the company's VAT rate is zero AND the company is not marked
// `is_vat_active` (the Phase 1 banking column), the report comes back empty
// and the page renders a clean "no VAT activity" state.

export type VatQuarterlyInvoiceRow = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  projectNumber: string | null;
  projectName: string | null;
  status: string;
  // ISO date of the event used to bucket the invoice into a quarter.
  // Prefers sentAt → invoiceDate when sentAt is null (legacy rows).
  effectiveDate: string;
  quarterKey: string; // 'YYYY-Qn'
  subtotal: number;
  vatRatePct: number;
  vatDue: number;
  /** Retainage held back on this invoice — explains the Subtotal+VAT vs
   *  Total discrepancy. Pulled straight from invoice.retainageAmount, so
   *  existing invoices show their stored retainage with no backfill. */
  retainage: number;
  total: number;
};

export type VatQuarterlyQuarterRow = {
  quarterKey: string;
  label: string; // 'Q1 2026'
  invoiceCount: number;
  subtotal: number;
  vatDue: number;
  retainage: number;
  total: number;
  // Input VAT (Phase B): aggregated from posted, recoverable receipts.
  receiptCount: number;
  expenseNet: number;
  inputVat: number;
  expenseGross: number;
  netVatDue: number; // vatDue − inputVat
};

export type VatQuarterlyExpenseRow = {
  receiptId: string;
  receiptDate: string;
  quarterKey: string;
  vendorName: string;
  projectNumber: string | null;
  projectName: string | null;
  subtotal: number;
  vatRatePct: number;
  inputVat: number;
  total: number;
  recoverable: boolean;
};

export type VatQuarterlyReport = {
  companyName: string;
  companyVatRatePct: number;
  /** When 0, the report has nothing to render — UI shows an empty state. */
  isVatActive: boolean;
  quarters: VatQuarterlyQuarterRow[];
  invoices: VatQuarterlyInvoiceRow[];
  expenses: VatQuarterlyExpenseRow[];
  totals: {
    invoiceCount: number;
    subtotal: number;
    vatDue: number;
    retainage: number;
    total: number;
    // Input VAT totals
    receiptCount: number;
    expenseNet: number;
    inputVat: number;
    expenseGross: number;
    netVatDue: number;
  };
};

function quarterKeyForDate(iso: string): { key: string; label: string } {
  // iso is YYYY-MM-DD (date) or full ISO timestamp — slice safely.
  const yyyy = iso.slice(0, 4);
  const mm = Number(iso.slice(5, 7));
  const q = Math.min(4, Math.max(1, Math.ceil(mm / 3)));
  return { key: `${yyyy}-Q${q}`, label: `Q${q} ${yyyy}` };
}

export async function buildVatQuarterlyReport(
  companyId: string,
  filters: ReportFilters,
): Promise<VatQuarterlyReport> {
  // Pull the active company so we know the VAT rate. Done via a direct
  // import to avoid a circular dependency through getActiveCompany.
  const { getCompany } = await import('@/lib/data/companies');
  const company = await getCompany(companyId);
  const companyName = company?.name ?? 'Active company';
  const companyVatRatePct = company ? Number(company.vatRatePercent) : 0;
  const isVatActive = companyVatRatePct > 0;

  if (!isVatActive) {
    return {
      companyName,
      companyVatRatePct,
      isVatActive,
      quarters: [],
      invoices: [],
      expenses: [],
      totals: {
        invoiceCount: 0,
        subtotal: 0,
        vatDue: 0,
        retainage: 0,
        total: 0,
        receiptCount: 0,
        expenseNet: 0,
        inputVat: 0,
        expenseGross: 0,
        netVatDue: 0,
      },
    };
  }

  const [invoices, customers, projects, receipts, vendors] = await Promise.all([
    listInvoices(companyId),
    listCustomers(companyId),
    listProjects(companyId),
    listReceipts(companyId, { status: 'posted', limit: 1000 }),
    listVendors(companyId),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  // Filter to non-draft / non-void invoices. Accrual VAT is owed for the
  // quarter the invoice was ISSUED — that's the `invoiceDate` (the date
  // on the document the customer received), not `sentAt` (when the user
  // happened to click "Mark sent" in the system, which is "today" for any
  // backfilled past invoice). Using invoiceDate makes backfill of past
  // invoices land in the correct quarter without operator gymnastics.
  const effectiveDate = (inv: (typeof invoices)[number]): string =>
    inv.invoiceDate;

  const filtered = invoices.filter((inv) => {
    if (inv.status === 'void') return false;
    if (inv.status === 'draft') return false;
    const effective = effectiveDate(inv);
    return filters.from || filters.to ? isInRange(effective, filters) : true;
  });

  const invoiceRows: VatQuarterlyInvoiceRow[] = filtered
    .map((inv) => {
      const effective = effectiveDate(inv);
      const project = inv.projectId ? projectById.get(inv.projectId) : null;
      const customer = project ? customerById.get(project.customerId) : null;
      const subtotal = parseMoney(inv.subtotal);
      const vatDue = round2((subtotal * companyVatRatePct) / 100);
      const retainage = parseMoney(inv.retainageAmount);
      const total = parseMoney(inv.total);
      const { key, label } = quarterKeyForDate(effective);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        customerName: customer?.name ?? '—',
        projectNumber: project?.number ?? null,
        projectName: project?.name ?? null,
        status: inv.status,
        effectiveDate: effective,
        quarterKey: key,
        // attach label here too so the per-quarter aggregate can reuse it
        _label: label,
        subtotal,
        vatRatePct: companyVatRatePct,
        vatDue,
        retainage,
        total,
      } as VatQuarterlyInvoiceRow & { _label: string };
    })
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  // Quarter rollup. Sort quarters newest-first for display.
  const byQuarter = new Map<string, VatQuarterlyQuarterRow>();
  function ensureQuarter(
    quarterKey: string,
    label: string,
  ): VatQuarterlyQuarterRow {
    const existing = byQuarter.get(quarterKey);
    if (existing) return existing;
    const fresh: VatQuarterlyQuarterRow = {
      quarterKey,
      label,
      invoiceCount: 0,
      subtotal: 0,
      vatDue: 0,
      retainage: 0,
      total: 0,
      receiptCount: 0,
      expenseNet: 0,
      inputVat: 0,
      expenseGross: 0,
      netVatDue: 0,
    };
    byQuarter.set(quarterKey, fresh);
    return fresh;
  }

  for (const row of invoiceRows as Array<
    VatQuarterlyInvoiceRow & { _label: string }
  >) {
    const q = ensureQuarter(row.quarterKey, row._label);
    q.invoiceCount += 1;
    q.subtotal = add(q.subtotal, row.subtotal);
    q.vatDue = add(q.vatDue, row.vatDue);
    q.retainage = add(q.retainage, row.retainage);
    q.total = add(q.total, row.total);
  }

  // ===== Input VAT: posted, recoverable receipts =====
  //
  // We aggregate every posted receipt regardless of its `vat_recoverable`
  // flag for the per-row detail, but only `recoverable=true` rows contribute
  // to the quarter-level `inputVat` / `netVatDue`. Non-recoverable VAT shows
  // in the per-row list with a flag — it's part of the receipt's true cost
  // (posted gross to job costs) and not reclaimable.
  const expenseRows: VatQuarterlyExpenseRow[] = [];
  for (const r of receipts) {
    const effective = r.receiptDate;
    if (filters.from || filters.to) {
      if (!isInRange(effective, filters)) continue;
    }
    const { key, label } = quarterKeyForDate(effective);
    const project = r.projectId ? projectById.get(r.projectId) : null;
    const vendor = r.vendorId ? vendorById.get(r.vendorId) : null;
    const subtotal = parseMoney(r.subtotal);
    const inputVat = parseMoney(r.vatAmount);
    const total = parseMoney(r.total);
    const ratePct = r.vatRatePercent ? Number(r.vatRatePercent) : 0;
    expenseRows.push({
      receiptId: r.id,
      receiptDate: effective,
      quarterKey: key,
      vendorName: vendor?.name ?? '—',
      projectNumber: project?.number ?? null,
      projectName: project?.name ?? null,
      subtotal,
      vatRatePct: ratePct,
      inputVat,
      total,
      recoverable: r.vatRecoverable,
    });
    const q = ensureQuarter(key, label);
    q.receiptCount += 1;
    q.expenseNet = add(q.expenseNet, subtotal);
    q.expenseGross = add(q.expenseGross, total);
    if (r.vatRecoverable) {
      q.inputVat = add(q.inputVat, inputVat);
    }
  }
  expenseRows.sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));

  // Net VAT due = output − input, per quarter.
  for (const q of byQuarter.values()) {
    q.netVatDue = round2(subtract(q.vatDue, q.inputVat));
  }

  const quarters = Array.from(byQuarter.values()).sort((a, b) =>
    b.quarterKey.localeCompare(a.quarterKey),
  );

  const totals = invoiceRows.reduce(
    (acc, r) => ({
      invoiceCount: acc.invoiceCount + 1,
      subtotal: add(acc.subtotal, r.subtotal),
      vatDue: add(acc.vatDue, r.vatDue),
      retainage: add(acc.retainage, r.retainage),
      total: add(acc.total, r.total),
      receiptCount: acc.receiptCount,
      expenseNet: acc.expenseNet,
      inputVat: acc.inputVat,
      expenseGross: acc.expenseGross,
      netVatDue: acc.netVatDue,
    }),
    {
      invoiceCount: 0,
      subtotal: 0,
      vatDue: 0,
      retainage: 0,
      total: 0,
      receiptCount: 0,
      expenseNet: 0,
      inputVat: 0,
      expenseGross: 0,
      netVatDue: 0,
    },
  );
  // Fold in the expense totals.
  for (const e of expenseRows) {
    totals.receiptCount += 1;
    totals.expenseNet = add(totals.expenseNet, e.subtotal);
    totals.expenseGross = add(totals.expenseGross, e.total);
    if (e.recoverable) {
      totals.inputVat = add(totals.inputVat, e.inputVat);
    }
  }
  totals.netVatDue = round2(subtract(totals.vatDue, totals.inputVat));

  // Strip the internal `_label` helper before returning.
  const cleanRows: VatQuarterlyInvoiceRow[] = invoiceRows.map((r) => {
    const { _label, ...rest } = r as VatQuarterlyInvoiceRow & {
      _label: string;
    };
    void _label;
    return rest;
  });

  return {
    companyName,
    companyVatRatePct,
    isVatActive,
    quarters,
    invoices: cleanRows,
    expenses: expenseRows,
    totals,
  };
}

// ===== Project Financial Report =====

export type ProjectFinancialRow = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  customerName: string;
  status: string;
  contractValue: number;
  changeOrders: number;
  revisedContractValue: number;
  totalInvoiced: number;
  totalPaid: number;
  /** Revenue (ex-VAT). Sum of invoice subtotals. */
  totalInvoicedNet: number;
  /** Sum of invoice taxAmount — VAT we'll owe once collected. */
  totalInvoicedVat: number;
  /** Revenue collected = paidGross * (subtotal / (subtotal + tax)). */
  totalPaidNet: number;
  /** VAT collected (a liability, not revenue). */
  totalPaidVat: number;
  /** Invoiced against base contract only (invoice.changeOrderId is null). */
  baseInvoiced: number;
  baseInvoicedPaid: number;
  /** Invoiced against any linked change order (invoice.changeOrderId set). */
  coInvoiced: number;
  coInvoicedPaid: number;
  outstandingAR: number;
  retainageHeld: number;
  retainageReleased: number;
  retainageBalance: number;
  totalCost: number;
  grossProfit: number;
  marginPct: number;
  verifiedAt: Date | null;
};

export type ProjectFinancialReport = {
  rows: ProjectFinancialRow[];
  totals: {
    contractValue: number;
    changeOrders: number;
    revisedContractValue: number;
    totalInvoiced: number;
    totalPaid: number;
    totalInvoicedNet: number;
    totalInvoicedVat: number;
    totalPaidNet: number;
    totalPaidVat: number;
    baseInvoiced: number;
    baseInvoicedPaid: number;
    coInvoiced: number;
    coInvoicedPaid: number;
    outstandingAR: number;
    retainageHeld: number;
    retainageReleased: number;
    retainageBalance: number;
    totalCost: number;
    grossProfit: number;
  };
  weightedMarginPct: number;
};

export async function buildProjectFinancialReport(
  companyId: string,
  filters: ReportFilters,
): Promise<ProjectFinancialReport> {
  const [projects, customers, invoices] = await Promise.all([
    listProjects(companyId),
    listCustomers(companyId),
    listInvoices(companyId),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const filtered = projects.filter(
    (p) => !filters.projectId || p.id === filters.projectId,
  );

  const rows: ProjectFinancialRow[] = await Promise.all(
    filtered.map(async (project) => {
      const fin = (await computeProjectFinancials(
        companyId,
        project.id,
      )) as ProjectFinancials | null;
      const projectInvoices = invoices.filter(
        (i) => i.projectId === project.id && i.status !== 'void',
      );
      // Apply date filter at invoice level (the spirit of the date range is to
      // restrict the billing window — contract still rolls up the whole project).
      const inRangeInvoices = projectInvoices.filter((i) =>
        filters.from || filters.to ? isInRange(i.invoiceDate, filters) : true,
      );
      const totalInvoiced = inRangeInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.total)),
        0,
      );
      const totalPaid = inRangeInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.amountPaid)),
        0,
      );
      // Net/VAT split — revenue is the subtotal (ex-VAT); the tax amount
      // is a liability collected on behalf of the government, never income.
      // Paid amounts split proportionally per invoice's tax/total ratio.
      const totalInvoicedNet = inRangeInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.subtotal)),
        0,
      );
      const totalInvoicedVat = inRangeInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.taxAmount)),
        0,
      );
      let totalPaidNet = 0;
      let totalPaidVat = 0;
      for (const i of inRangeInvoices) {
        const sub = parseMoney(i.subtotal);
        const tax = parseMoney(i.taxAmount);
        const paid = parseMoney(i.amountPaid);
        const denom = sub + tax;
        const vatShare = denom > 0 ? tax / denom : 0;
        const paidVat = paid * vatShare;
        totalPaidVat = add(totalPaidVat, paidVat);
        totalPaidNet = add(totalPaidNet, paid - paidVat);
      }
      // Split by contract source. Invoices without a CO link bill against
      // the base contract; the rest bill against an approved CO.
      const baseInvoices = inRangeInvoices.filter((i) => !i.changeOrderId);
      const coInvoices = inRangeInvoices.filter((i) => i.changeOrderId);
      const baseInvoiced = baseInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.total)),
        0,
      );
      const baseInvoicedPaid = baseInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.amountPaid)),
        0,
      );
      const coInvoiced = coInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.total)),
        0,
      );
      const coInvoicedPaid = coInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.amountPaid)),
        0,
      );
      const retainageHeld = inRangeInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.retainageAmount)),
        0,
      );
      const retainageReleased = inRangeInvoices.reduce(
        (acc, i) => add(acc, parseMoney(i.retainageReleased)),
        0,
      );

      const totalCost = fin?.actualCost ?? 0;
      const revised = parseMoney(project.contractValue);
      const grossProfit = subtract(revised, totalCost);
      const marginPct = revised > 0 ? round2((grossProfit / revised) * 100) : 0;

      return {
        projectId: project.id,
        projectNumber: project.number,
        projectName: project.name,
        customerName: customerById.get(project.customerId)?.name ?? 'Unknown',
        status: project.status,
        contractValue: parseMoney(project.originalContractValue),
        changeOrders: parseMoney(project.totalChangeOrders),
        revisedContractValue: revised,
        totalInvoiced: round2(totalInvoiced),
        totalPaid: round2(totalPaid),
        totalInvoicedNet: round2(totalInvoicedNet),
        totalInvoicedVat: round2(totalInvoicedVat),
        totalPaidNet: round2(totalPaidNet),
        totalPaidVat: round2(totalPaidVat),
        baseInvoiced: round2(baseInvoiced),
        baseInvoicedPaid: round2(baseInvoicedPaid),
        coInvoiced: round2(coInvoiced),
        coInvoicedPaid: round2(coInvoicedPaid),
        outstandingAR: round2(subtract(totalInvoiced, totalPaid)),
        retainageHeld: round2(retainageHeld),
        retainageReleased: round2(retainageReleased),
        retainageBalance: round2(subtract(retainageHeld, retainageReleased)),
        totalCost: round2(totalCost),
        grossProfit: round2(grossProfit),
        marginPct,
        verifiedAt: project.reconciliationVerifiedAt,
      };
    }),
  );

  const totals = rows.reduce(
    (acc, r) => ({
      contractValue: add(acc.contractValue, r.contractValue),
      changeOrders: add(acc.changeOrders, r.changeOrders),
      revisedContractValue: add(
        acc.revisedContractValue,
        r.revisedContractValue,
      ),
      totalInvoiced: add(acc.totalInvoiced, r.totalInvoiced),
      totalPaid: add(acc.totalPaid, r.totalPaid),
      totalInvoicedNet: add(acc.totalInvoicedNet, r.totalInvoicedNet),
      totalInvoicedVat: add(acc.totalInvoicedVat, r.totalInvoicedVat),
      totalPaidNet: add(acc.totalPaidNet, r.totalPaidNet),
      totalPaidVat: add(acc.totalPaidVat, r.totalPaidVat),
      baseInvoiced: add(acc.baseInvoiced, r.baseInvoiced),
      baseInvoicedPaid: add(acc.baseInvoicedPaid, r.baseInvoicedPaid),
      coInvoiced: add(acc.coInvoiced, r.coInvoiced),
      coInvoicedPaid: add(acc.coInvoicedPaid, r.coInvoicedPaid),
      outstandingAR: add(acc.outstandingAR, r.outstandingAR),
      retainageHeld: add(acc.retainageHeld, r.retainageHeld),
      retainageReleased: add(acc.retainageReleased, r.retainageReleased),
      retainageBalance: add(acc.retainageBalance, r.retainageBalance),
      totalCost: add(acc.totalCost, r.totalCost),
      grossProfit: add(acc.grossProfit, r.grossProfit),
    }),
    {
      contractValue: 0,
      changeOrders: 0,
      revisedContractValue: 0,
      totalInvoiced: 0,
      totalPaid: 0,
      totalInvoicedNet: 0,
      totalInvoicedVat: 0,
      totalPaidNet: 0,
      totalPaidVat: 0,
      baseInvoiced: 0,
      baseInvoicedPaid: 0,
      coInvoiced: 0,
      coInvoicedPaid: 0,
      outstandingAR: 0,
      retainageHeld: 0,
      retainageReleased: 0,
      retainageBalance: 0,
      totalCost: 0,
      grossProfit: 0,
    },
  );

  const weightedMarginPct =
    totals.revisedContractValue > 0
      ? round2((totals.grossProfit / totals.revisedContractValue) * 100)
      : 0;

  return { rows, totals, weightedMarginPct };
}

// ===== Job Cost Report =====

export type JobCostProjectRow = ProjectFinancials & {
  projectStatus: string;
};

export type JobCostReport = {
  rows: JobCostProjectRow[];
  costCodeBreakdown: (CostCodeBreakdownRow & {
    projectId: string;
    projectNumber: string;
  })[];
  totals: {
    revisedContractValue: number;
    estimatedCost: number;
    committedCost: number;
    actualCost: number;
    landedCostTotal: number;
    grossProfit: number;
  };
  weightedMarginPct: number;
};

export async function buildJobCostReport(
  companyId: string,
  filters: ReportFilters,
): Promise<JobCostReport> {
  const projects = await listProjects(companyId);
  const filtered = projects.filter(
    (p) => !filters.projectId || p.id === filters.projectId,
  );

  const rows: JobCostProjectRow[] = [];
  const costCodeBreakdown: JobCostReport['costCodeBreakdown'] = [];
  for (const project of filtered) {
    const fin = await computeProjectFinancials(companyId, project.id);
    if (!fin) continue;
    rows.push({ ...fin, projectStatus: project.status });
    const breakdown = await computeProjectCostCodeBreakdown(
      companyId,
      project.id,
    );
    for (const r of breakdown) {
      costCodeBreakdown.push({
        ...r,
        projectId: project.id,
        projectNumber: project.number,
      });
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      revisedContractValue: add(acc.revisedContractValue, r.revisedContractValue),
      estimatedCost: add(acc.estimatedCost, r.estimatedCost),
      committedCost: add(acc.committedCost, r.committedCost),
      actualCost: add(acc.actualCost, r.actualCost),
      landedCostTotal: add(acc.landedCostTotal, r.landedCostTotal),
      grossProfit: add(acc.grossProfit, r.projectedGrossProfit),
    }),
    {
      revisedContractValue: 0,
      estimatedCost: 0,
      committedCost: 0,
      actualCost: 0,
      landedCostTotal: 0,
      grossProfit: 0,
    },
  );
  const weightedMarginPct =
    totals.revisedContractValue > 0
      ? round2((totals.grossProfit / totals.revisedContractValue) * 100)
      : 0;
  return { rows, costCodeBreakdown, totals, weightedMarginPct };
}

// ===== Accounts Receivable Report =====

export type ARCustomerRow = {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  totalAR: number;
  /** Outstanding AR billed against the original base contract. Gross. */
  baseAR: number;
  /** Outstanding AR billed against approved change orders. Gross. */
  coAR: number;
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
  overdueCount: number;
};

export type ARReport = {
  asOf: Date;
  customerRows: ARCustomerRow[];
  agingRows: AgingRow[];
  summary: AgingSummary;
};

export async function buildARReport(
  companyId: string,
  filters: ReportFilters,
): Promise<ARReport> {
  const asOf = filters.to
    ? new Date(`${filters.to}T00:00:00Z`)
    : new Date();
  const allRows = await buildAgingRowsForCompany(companyId, asOf);
  // Apply optional `from` filter on invoiceDate.
  const agingRows = allRows.filter((r) =>
    filters.from ? r.invoiceDate >= filters.from : true,
  );

  const byCustomer = new Map<string, ARCustomerRow>();
  for (const r of agingRows) {
    const existing = byCustomer.get(r.customerId) ?? {
      customerId: r.customerId,
      customerName: r.customerName,
      invoiceCount: 0,
      totalAR: 0,
      baseAR: 0,
      coAR: 0,
      current: 0,
      b1_30: 0,
      b31_60: 0,
      b61_90: 0,
      b90_plus: 0,
      overdueCount: 0,
    };
    existing.invoiceCount += 1;
    existing.totalAR = add(existing.totalAR, r.balance);
    if (r.changeOrderId) {
      existing.coAR = add(existing.coAR, r.balance);
    } else {
      existing.baseAR = add(existing.baseAR, r.balance);
    }
    existing[r.bucket] = add(existing[r.bucket], r.balance);
    if (r.daysOverdue > 0) existing.overdueCount += 1;
    byCustomer.set(r.customerId, existing);
  }
  const customerRows = Array.from(byCustomer.values()).sort(
    (a, b) => b.totalAR - a.totalAR,
  );
  return {
    asOf,
    customerRows,
    agingRows,
    summary: summarizeAging(agingRows),
  };
}

export { AGING_BUCKETS, BUCKET_LABEL };
export type { AgingBucket };

// ===== Invoice Summary Report =====

export type InvoiceSummaryRow = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  customerName: string;
  status: string;
  billingType: string;
  subtotal: number;
  taxAmount: number;
  retainageHeld: number;
  total: number;
  amountPaid: number;
  balance: number;
  lineCount: number;
};

export type InvoiceSummaryReport = {
  rows: InvoiceSummaryRow[];
  totals: {
    subtotal: number;
    taxAmount: number;
    retainageHeld: number;
    total: number;
    amountPaid: number;
    balance: number;
  };
};

export async function buildInvoiceSummaryReport(
  companyId: string,
  filters: ReportFilters,
): Promise<InvoiceSummaryReport> {
  const [invoices, projects, customers] = await Promise.all([
    listInvoices(companyId),
    listProjects(companyId),
    listCustomers(companyId),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const filtered = invoices
    .filter((i) => normalizeStatus('invoice', i.status) !== 'void')
    .filter((i) =>
      filters.from || filters.to ? isInRange(i.invoiceDate, filters) : true,
    )
    .filter(
      (i) => !filters.projectId || i.projectId === filters.projectId,
    );

  const rows: InvoiceSummaryRow[] = await Promise.all(
    filtered.map(async (i) => {
      const project = projectById.get(i.projectId);
      const customer = project ? customerById.get(project.customerId) : undefined;
      const lines = await getInvoiceLineItems(i.id);
      const balance = subtract(parseMoney(i.total), parseMoney(i.amountPaid));
      return {
        invoiceId: i.id,
        invoiceNumber: i.number,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        projectId: i.projectId,
        projectName: project?.name ?? 'Unknown project',
        customerName: customer?.name ?? 'Unknown customer',
        status: i.status,
        billingType: i.billingType,
        subtotal: parseMoney(i.subtotal),
        taxAmount: parseMoney(i.taxAmount),
        retainageHeld: parseMoney(i.retainageAmount),
        total: parseMoney(i.total),
        amountPaid: parseMoney(i.amountPaid),
        balance: round2(balance),
        lineCount: lines.length,
      };
    }),
  );
  rows.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  const totals = rows.reduce(
    (acc, r) => ({
      subtotal: add(acc.subtotal, r.subtotal),
      taxAmount: add(acc.taxAmount, r.taxAmount),
      retainageHeld: add(acc.retainageHeld, r.retainageHeld),
      total: add(acc.total, r.total),
      amountPaid: add(acc.amountPaid, r.amountPaid),
      balance: add(acc.balance, r.balance),
    }),
    {
      subtotal: 0,
      taxAmount: 0,
      retainageHeld: 0,
      total: 0,
      amountPaid: 0,
      balance: 0,
    },
  );
  return { rows, totals };
}

// ===== Payment Summary Report =====

export type PaymentSummaryRow = {
  paymentId: string;
  paymentNumber: string;
  paidDate: string;
  amount: number;
  method: string | null;
  status: string;
  reference: string | null;
  bankAccount: string | null;
  invoiceNumber: string;
  customerName: string;
  projectName: string;
  projectId: string;
};

export type PaymentSummaryReport = {
  rows: PaymentSummaryRow[];
  totals: {
    received: number;
    applied: number;
    pending: number;
    returned: number;
    total: number;
  };
  byMethod: { method: string; count: number; total: number }[];
};

export async function buildPaymentSummaryReport(
  companyId: string,
  filters: ReportFilters,
): Promise<PaymentSummaryReport> {
  const [payments, invoices, projects, customers] = await Promise.all([
    listPayments(companyId),
    listInvoices(companyId),
    listProjects(companyId),
    listCustomers(companyId),
  ]);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const filtered = payments
    .filter((p) =>
      filters.from || filters.to ? isInRange(p.paidDate, filters) : true,
    )
    .filter((p) => {
      if (!filters.projectId) return true;
      const inv = invoiceById.get(p.invoiceId);
      return inv?.projectId === filters.projectId;
    });

  const rows: PaymentSummaryRow[] = filtered.map((p) => {
    const inv = invoiceById.get(p.invoiceId);
    const project = inv ? projectById.get(inv.projectId) : undefined;
    const customer = project ? customerById.get(project.customerId) : undefined;
    return {
      paymentId: p.id,
      paymentNumber: p.paymentNumber,
      paidDate: p.paidDate,
      amount: parseMoney(p.amount),
      method: p.method,
      status: p.status,
      reference: p.reference,
      bankAccount: p.bankAccount,
      invoiceNumber: inv?.number ?? '—',
      customerName: customer?.name ?? '—',
      projectName: project?.name ?? '—',
      projectId: project?.id ?? '',
    };
  });
  rows.sort((a, b) => b.paidDate.localeCompare(a.paidDate));

  const totals = rows.reduce(
    (acc, r) => {
      acc.total = add(acc.total, r.amount);
      if (r.status === 'received') acc.received = add(acc.received, r.amount);
      if (r.status === 'applied') acc.applied = add(acc.applied, r.amount);
      if (r.status === 'pending') acc.pending = add(acc.pending, r.amount);
      if (r.status === 'returned') acc.returned = add(acc.returned, r.amount);
      return acc;
    },
    { received: 0, applied: 0, pending: 0, returned: 0, total: 0 },
  );

  const byMethodMap = new Map<string, { method: string; count: number; total: number }>();
  for (const r of rows) {
    const method = r.method ?? 'unknown';
    const cur = byMethodMap.get(method) ?? { method, count: 0, total: 0 };
    cur.count += 1;
    cur.total = add(cur.total, r.amount);
    byMethodMap.set(method, cur);
  }
  const byMethod = Array.from(byMethodMap.values()).sort(
    (a, b) => b.total - a.total,
  );

  return { rows, totals, byMethod };
}

// ===== Purchase Order Summary =====

export type POSummaryRow = {
  poId: string;
  poNumber: string;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  status: string;
  vendorId: string;
  vendorName: string;
  projectId: string;
  projectName: string;
  subtotal: number;
  taxAmount: number;
  shipping: number;
  total: number;
  lineCount: number;
};

export type POSummaryReport = {
  rows: POSummaryRow[];
  totals: {
    subtotal: number;
    taxAmount: number;
    shipping: number;
    total: number;
    open: number;
    closed: number;
  };
  byStatus: { status: string; count: number; total: number }[];
};

export async function buildPOSummaryReport(
  companyId: string,
  filters: ReportFilters,
): Promise<POSummaryReport> {
  const [pos, projects] = await Promise.all([
    listPurchaseOrders(companyId),
    listProjects(companyId),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const filtered = pos
    .filter((po) => normalizeStatus('purchase_order', po.status) !== 'void')
    .filter((po) =>
      filters.from || filters.to ? isInRange(po.issueDate, filters) : true,
    )
    .filter((po) => !filters.projectId || po.projectId === filters.projectId);

  const rows: POSummaryRow[] = await Promise.all(
    filtered.map(async (po) => {
      const project = projectById.get(po.projectId);
      const vendor = await getVendor(companyId, po.vendorId);
      const lines = await getPurchaseOrderLines(po.id);
      return {
        poId: po.id,
        poNumber: po.number,
        issueDate: po.issueDate,
        expectedDeliveryDate: po.expectedDeliveryDate,
        status: po.status,
        vendorId: po.vendorId,
        vendorName: vendor?.name ?? '—',
        projectId: po.projectId,
        projectName: project?.name ?? '—',
        subtotal: parseMoney(po.subtotal),
        taxAmount: parseMoney(po.taxAmount),
        shipping: parseMoney(po.shipping),
        total: parseMoney(po.total),
        lineCount: lines.length,
      };
    }),
  );
  rows.sort((a, b) => (b.issueDate ?? '').localeCompare(a.issueDate ?? ''));

  const totals = rows.reduce(
    (acc, r) => {
      acc.subtotal = add(acc.subtotal, r.subtotal);
      acc.taxAmount = add(acc.taxAmount, r.taxAmount);
      acc.shipping = add(acc.shipping, r.shipping);
      acc.total = add(acc.total, r.total);
      const c = normalizeStatus('purchase_order', r.status);
      if (c === 'closed' || c === 'received') acc.closed = add(acc.closed, r.total);
      else acc.open = add(acc.open, r.total);
      return acc;
    },
    { subtotal: 0, taxAmount: 0, shipping: 0, total: 0, open: 0, closed: 0 },
  );

  const byStatusMap = new Map<string, { status: string; count: number; total: number }>();
  for (const r of rows) {
    const cur = byStatusMap.get(r.status) ?? {
      status: r.status,
      count: 0,
      total: 0,
    };
    cur.count += 1;
    cur.total = add(cur.total, r.total);
    byStatusMap.set(r.status, cur);
  }
  const byStatus = Array.from(byStatusMap.values()).sort(
    (a, b) => b.total - a.total,
  );

  return { rows, totals, byStatus };
}

// ===== Landed Cost Summary =====

export type LandedCostRow = {
  id: string;
  name: string;
  carrier: string | null;
  projectId: string | null;
  projectName: string;
  vendorName: string;
  tariffCode: string | null;
  quantity: number;
  fob: number;
  cif: number;
  dutyAmount: number;
  vatAmount: number;
  brokerage: number;
  totalLandedCost: number;
  perUnitCost: number;
  createdAt: Date;
};

export type LandedCostReport = {
  rows: LandedCostRow[];
  totals: {
    fob: number;
    cif: number;
    dutyAmount: number;
    vatAmount: number;
    brokerage: number;
    totalLandedCost: number;
  };
  effectiveDutyVatPct: number;
};

export async function buildLandedCostReport(
  companyId: string,
  filters: ReportFilters,
): Promise<LandedCostReport> {
  const [landedCosts, projects] = await Promise.all([
    listLandedCosts(companyId),
    listProjects(companyId),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const filtered = landedCosts
    .filter((l) => {
      const created = l.createdAt.toISOString().slice(0, 10);
      return filters.from || filters.to ? isInRange(created, filters) : true;
    })
    .filter((l) => !filters.projectId || l.projectId === filters.projectId);

  const rows: LandedCostRow[] = filtered.map((l) => {
    const project = l.projectId ? projectById.get(l.projectId) : undefined;
    return {
      id: l.id,
      name: l.name,
      carrier: l.carrier,
      projectId: l.projectId,
      projectName: project?.name ?? '—',
      vendorName: '—', // could resolve l.vendorId if needed
      tariffCode: l.tariffCode,
      quantity: parseMoney(l.quantity),
      fob: parseMoney(l.fob),
      cif: parseMoney(l.cif),
      dutyAmount: parseMoney(l.dutyAmount),
      vatAmount: parseMoney(l.vatAmount),
      brokerage: parseMoney(l.brokerage),
      totalLandedCost: parseMoney(l.totalLandedCost),
      perUnitCost: parseMoney(l.perUnitCost),
      createdAt: l.createdAt,
    };
  });
  rows.sort((a, b) => +b.createdAt - +a.createdAt);

  const totals = rows.reduce(
    (acc, r) => ({
      fob: add(acc.fob, r.fob),
      cif: add(acc.cif, r.cif),
      dutyAmount: add(acc.dutyAmount, r.dutyAmount),
      vatAmount: add(acc.vatAmount, r.vatAmount),
      brokerage: add(acc.brokerage, r.brokerage),
      totalLandedCost: add(acc.totalLandedCost, r.totalLandedCost),
    }),
    { fob: 0, cif: 0, dutyAmount: 0, vatAmount: 0, brokerage: 0, totalLandedCost: 0 },
  );
  const effectiveDutyVatPct =
    totals.cif > 0
      ? round2(((totals.dutyAmount + totals.vatAmount) / totals.cif) * 100)
      : 0;

  // Suppress unused-import lint warning; kept available for future
  // change-order-by-period rollups inside this module.
  void listChangeOrders;

  return { rows, totals, effectiveDutyVatPct };
}

// =====================================================================
// Customer Summary Report
// =====================================================================
//
// Pick a customer and see every project under them with:
//   - contract value (revised = base + approved COs)
//   - billed (gross + net split + base/CO source split)
//   - still billable (revised contract − billed gross)
//   - collected (gross + net)
//   - outstanding (billed − collected)
//   - retainage held
// Plus a flat list of every invoice for that customer with the same
// base/CO source flag the AR report uses.
//
// When no customer is selected (filters.customerId empty), the report
// returns empty rows and the page shows an empty-state nudge to pick one.

export type CustomerProjectRow = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  status: string;
  contractValue: number;
  changeOrders: number;
  revisedContractValue: number;
  totalInvoiced: number;
  totalInvoicedNet: number;
  totalInvoicedVat: number;
  baseInvoiced: number;
  coInvoiced: number;
  /** Revised contract − billed (gross). Negative means over-billed. */
  stillBillable: number;
  totalPaid: number;
  totalPaidNet: number;
  outstandingAR: number;
  retainageHeld: number;
  retainageReleased: number;
  retainageBalance: number;
};

export type CustomerInvoiceRow = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  projectId: string;
  projectNumber: string;
  projectName: string;
  status: string;
  /** 'base' when invoice has no changeOrderId; 'co' otherwise. */
  source: 'base' | 'co';
  /** When source = 'co', the change order's display number ('CO-101' style),
   *  otherwise null. */
  changeOrderNumber: string | null;
  total: number;
  subtotal: number;
  taxAmount: number;
  amountPaid: number;
  balance: number;
};

export type CustomerSummaryReport = {
  /** Picked customer, or null when no selection was made. */
  customer: { id: string; name: string } | null;
  projectRows: CustomerProjectRow[];
  invoiceRows: CustomerInvoiceRow[];
  totals: {
    contractValue: number;
    changeOrders: number;
    revisedContractValue: number;
    totalInvoiced: number;
    totalInvoicedNet: number;
    totalInvoicedVat: number;
    baseInvoiced: number;
    coInvoiced: number;
    stillBillable: number;
    totalPaid: number;
    totalPaidNet: number;
    outstandingAR: number;
    retainageHeld: number;
    retainageReleased: number;
    retainageBalance: number;
    invoiceCount: number;
    projectCount: number;
  };
};

export async function buildCustomerSummaryReport(
  companyId: string,
  filters: ReportFilters,
): Promise<CustomerSummaryReport> {
  const customers = await listCustomers(companyId);
  const customer = filters.customerId
    ? (customers.find((c) => c.id === filters.customerId) ?? null)
    : null;
  if (!customer) {
    return {
      customer: null,
      projectRows: [],
      invoiceRows: [],
      totals: {
        contractValue: 0,
        changeOrders: 0,
        revisedContractValue: 0,
        totalInvoiced: 0,
        totalInvoicedNet: 0,
        totalInvoicedVat: 0,
        baseInvoiced: 0,
        coInvoiced: 0,
        stillBillable: 0,
        totalPaid: 0,
        totalPaidNet: 0,
        outstandingAR: 0,
        retainageHeld: 0,
        retainageReleased: 0,
        retainageBalance: 0,
        invoiceCount: 0,
        projectCount: 0,
      },
    };
  }

  const allProjects = await listProjects(companyId);
  const projects = allProjects.filter((p) => p.customerId === customer.id);
  const changeOrders = await listChangeOrders(companyId);
  const coById = new Map(changeOrders.map((co) => [co.id, co]));

  const projectRows: CustomerProjectRow[] = [];
  const invoiceRows: CustomerInvoiceRow[] = [];

  for (const p of projects) {
    const bySource = await computeProjectInvoicesByContractSource(p.id);
    const invoices = await listInvoicesForProject(p.id);

    const coTotals = bySource.byChangeOrder.reduce(
      (acc, b) => ({
        invoiced: acc.invoiced + b.totalInvoiced,
        invoicedNet: acc.invoicedNet + b.totalInvoicedNet,
        invoicedVat: acc.invoicedVat + b.totalInvoicedVat,
        paid: acc.paid + b.totalPaid,
        paidNet: acc.paidNet + b.totalPaidNet,
        outstanding: acc.outstanding + b.outstandingBalance,
      }),
      { invoiced: 0, invoicedNet: 0, invoicedVat: 0, paid: 0, paidNet: 0, outstanding: 0 },
    );

    const totalInvoiced = bySource.base.totalInvoiced + coTotals.invoiced;
    const totalInvoicedNet = bySource.base.totalInvoicedNet + coTotals.invoicedNet;
    const totalInvoicedVat = bySource.base.totalInvoicedVat + coTotals.invoicedVat;
    const totalPaid = bySource.base.totalPaid + coTotals.paid;
    const totalPaidNet = bySource.base.totalPaidNet + coTotals.paidNet;
    const outstandingAR = bySource.base.outstandingBalance + coTotals.outstanding;
    const retainageHeld =
      bySource.base.retainageHeld +
      bySource.byChangeOrder.reduce((s, b) => s + b.retainageHeld, 0);
    const retainageReleased =
      bySource.base.retainageReleased +
      bySource.byChangeOrder.reduce((s, b) => s + b.retainageReleased, 0);

    const contractValue = parseMoney(p.originalContractValue);
    const revisedContractValue = parseMoney(p.contractValue);
    const changeOrdersTotal = subtract(revisedContractValue, contractValue);
    const stillBillable = round2(subtract(revisedContractValue, totalInvoiced));

    projectRows.push({
      projectId: p.id,
      projectNumber: p.number,
      projectName: p.name,
      status: p.status,
      contractValue: round2(contractValue),
      changeOrders: round2(changeOrdersTotal),
      revisedContractValue: round2(revisedContractValue),
      totalInvoiced: round2(totalInvoiced),
      totalInvoicedNet: round2(totalInvoicedNet),
      totalInvoicedVat: round2(totalInvoicedVat),
      baseInvoiced: round2(bySource.base.totalInvoiced),
      coInvoiced: round2(coTotals.invoiced),
      stillBillable,
      totalPaid: round2(totalPaid),
      totalPaidNet: round2(totalPaidNet),
      outstandingAR: round2(outstandingAR),
      retainageHeld: round2(retainageHeld),
      retainageReleased: round2(retainageReleased),
      retainageBalance: round2(retainageHeld - retainageReleased),
    });

    for (const inv of invoices) {
      if (normalizeStatus('invoice', inv.status) === 'void') continue;
      if (filters.from || filters.to) {
        if (!isInRange(inv.invoiceDate, filters)) continue;
      }
      const total = parseMoney(inv.total);
      const subtotal = parseMoney(inv.subtotal);
      const taxAmount = parseMoney(inv.taxAmount);
      const amountPaid = parseMoney(inv.amountPaid);
      const balance = round2(Math.max(0, subtract(total, amountPaid)));
      const co = inv.changeOrderId ? coById.get(inv.changeOrderId) : undefined;
      invoiceRows.push({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        projectId: p.id,
        projectNumber: p.number,
        projectName: p.name,
        status: inv.status,
        source: inv.changeOrderId ? 'co' : 'base',
        changeOrderNumber: co?.number ?? null,
        total: round2(total),
        subtotal: round2(subtotal),
        taxAmount: round2(taxAmount),
        amountPaid: round2(amountPaid),
        balance,
      });
    }
  }

  // Sort: projects by status (active first) then by number; invoices by date desc.
  projectRows.sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
  invoiceRows.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));

  const totals = projectRows.reduce(
    (acc, r) => ({
      contractValue: add(acc.contractValue, r.contractValue),
      changeOrders: add(acc.changeOrders, r.changeOrders),
      revisedContractValue: add(acc.revisedContractValue, r.revisedContractValue),
      totalInvoiced: add(acc.totalInvoiced, r.totalInvoiced),
      totalInvoicedNet: add(acc.totalInvoicedNet, r.totalInvoicedNet),
      totalInvoicedVat: add(acc.totalInvoicedVat, r.totalInvoicedVat),
      baseInvoiced: add(acc.baseInvoiced, r.baseInvoiced),
      coInvoiced: add(acc.coInvoiced, r.coInvoiced),
      stillBillable: add(acc.stillBillable, r.stillBillable),
      totalPaid: add(acc.totalPaid, r.totalPaid),
      totalPaidNet: add(acc.totalPaidNet, r.totalPaidNet),
      outstandingAR: add(acc.outstandingAR, r.outstandingAR),
      retainageHeld: add(acc.retainageHeld, r.retainageHeld),
      retainageReleased: add(acc.retainageReleased, r.retainageReleased),
      retainageBalance: add(acc.retainageBalance, r.retainageBalance),
      invoiceCount: acc.invoiceCount,
      projectCount: acc.projectCount,
    }),
    {
      contractValue: 0,
      changeOrders: 0,
      revisedContractValue: 0,
      totalInvoiced: 0,
      totalInvoicedNet: 0,
      totalInvoicedVat: 0,
      baseInvoiced: 0,
      coInvoiced: 0,
      stillBillable: 0,
      totalPaid: 0,
      totalPaidNet: 0,
      outstandingAR: 0,
      retainageHeld: 0,
      retainageReleased: 0,
      retainageBalance: 0,
      invoiceCount: invoiceRows.length,
      projectCount: projectRows.length,
    },
  );

  return {
    customer: { id: customer.id, name: customer.name },
    projectRows,
    invoiceRows,
    totals,
  };
}
