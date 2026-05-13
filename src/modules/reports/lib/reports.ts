// Server-only builders for each of the 7 report types. Each returns a typed
// data structure with summary KPIs and detailed rows; the page renders the
// HTML view and the CSV route handler renders the same data into a flat
// CSV. Both consume this module — never duplicate the math.

import 'server-only';
import { listCustomers } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { listInvoices, getInvoiceLineItems } from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
import {
  listPurchaseOrders,
  getPurchaseOrderLines,
} from '@/lib/data/purchase-orders';
import { listLandedCosts } from '@/lib/data/landed-costs';
import { listChangeOrders } from '@/lib/data/change-orders';
import { getVendor } from '@/lib/data/vendors';
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
// Accrual-basis VAT liability. Every non-void invoice that's been sent
// contributes its VAT to the quarter it was sent in. VAT amount per invoice
// is computed as `subtotal × company.vatRatePercent / 100`, so when a
// company's VAT rate is zero (e.g., Kraken Roofing) the report comes back
// empty and the page renders a clean "no VAT activity" state.

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
  total: number;
};

export type VatQuarterlyQuarterRow = {
  quarterKey: string;
  label: string; // 'Q1 2026'
  invoiceCount: number;
  subtotal: number;
  vatDue: number;
  total: number;
};

export type VatQuarterlyReport = {
  companyName: string;
  companyVatRatePct: number;
  /** When 0, the report has nothing to render — UI shows an empty state. */
  isVatActive: boolean;
  quarters: VatQuarterlyQuarterRow[];
  invoices: VatQuarterlyInvoiceRow[];
  totals: {
    invoiceCount: number;
    subtotal: number;
    vatDue: number;
    total: number;
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
      totals: { invoiceCount: 0, subtotal: 0, vatDue: 0, total: 0 },
    };
  }

  const [invoices, customers, projects] = await Promise.all([
    listInvoices(companyId),
    listCustomers(companyId),
    listProjects(companyId),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Filter to non-draft / non-void invoices. Accrual basis: the moment a
  // customer is billed, VAT is owed for that quarter even if unpaid.
  // sentAt is a nullable Date; fall back to invoiceDate when missing
  // (e.g., legacy rows created before the status-transition stamp was wired).
  const effectiveDate = (inv: (typeof invoices)[number]): string =>
    inv.sentAt ? inv.sentAt.toISOString().slice(0, 10) : inv.invoiceDate;

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
        total,
      } as VatQuarterlyInvoiceRow & { _label: string };
    })
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  // Quarter rollup. Sort quarters newest-first for display.
  const byQuarter = new Map<string, VatQuarterlyQuarterRow>();
  for (const row of invoiceRows as Array<
    VatQuarterlyInvoiceRow & { _label: string }
  >) {
    const existing = byQuarter.get(row.quarterKey);
    if (existing) {
      existing.invoiceCount += 1;
      existing.subtotal = add(existing.subtotal, row.subtotal);
      existing.vatDue = add(existing.vatDue, row.vatDue);
      existing.total = add(existing.total, row.total);
    } else {
      byQuarter.set(row.quarterKey, {
        quarterKey: row.quarterKey,
        label: row._label,
        invoiceCount: 1,
        subtotal: row.subtotal,
        vatDue: row.vatDue,
        total: row.total,
      });
    }
  }
  const quarters = Array.from(byQuarter.values()).sort((a, b) =>
    b.quarterKey.localeCompare(a.quarterKey),
  );

  const totals = invoiceRows.reduce(
    (acc, r) => ({
      invoiceCount: acc.invoiceCount + 1,
      subtotal: add(acc.subtotal, r.subtotal),
      vatDue: add(acc.vatDue, r.vatDue),
      total: add(acc.total, r.total),
    }),
    { invoiceCount: 0, subtotal: 0, vatDue: 0, total: 0 },
  );

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
      current: 0,
      b1_30: 0,
      b31_60: 0,
      b61_90: 0,
      b90_plus: 0,
      overdueCount: 0,
    };
    existing.invoiceCount += 1;
    existing.totalAR = add(existing.totalAR, r.balance);
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
