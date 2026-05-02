// Server-only progress + warnings rollup for the Backfill flow.
//
// "Backfill" is the wizard at /backfill that helps an operator enter
// historical business records starting from January 1, 2026 forward. This
// module reads through the data layer (DB or mock fallback, automatically)
// and produces:
//   - per-step counts (records entered since the cutoff)
//   - completion flags
//   - data warnings (missing links, unresolved balances, etc.)
//   - aggregate KPIs for the review page

import 'server-only';
import { listCustomers } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { listEstimates } from '@/lib/data/estimates';
import { listProposals } from '@/lib/data/proposals';
import { listChangeOrders } from '@/lib/data/change-orders';
import { listPurchaseOrders } from '@/lib/data/purchase-orders';
import { listLandedCosts } from '@/lib/data/landed-costs';
import { listInvoices } from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
import { listRetainageReleases } from '@/lib/data/retainage-releases';
import { add, parseMoney, subtract } from '@/lib/money';
import { normalizeStatus } from '@/lib/status-machine';

/** Earliest date the backfill flow accepts. Ignore older rows when computing
 * progress so legacy/demo seed data doesn't masquerade as backfilled. */
export const BACKFILL_CUTOFF_ISO = '2026-01-01';

export const BACKFILL_STEPS = [
  'customers',
  'projects',
  'proposals',
  'change-orders',
  'invoices',
  'payments',
  'purchase-orders',
  'retainage',
] as const;
export type BackfillStep = (typeof BACKFILL_STEPS)[number];

export const STEP_LABEL: Record<BackfillStep, string> = {
  customers: 'Customers',
  projects: 'Projects',
  proposals: 'Contracts / Proposals',
  'change-orders': 'Change Orders',
  invoices: 'Invoices',
  payments: 'Payments',
  'purchase-orders': 'Purchase Orders / Costs',
  retainage: 'Retainage',
};

export const STEP_DESCRIPTION: Record<BackfillStep, string> = {
  customers: 'Customer master records — who you do work for.',
  projects:
    'One project per contracted job. Each must reference a customer.',
  proposals:
    'Estimates and proposals tied to projects. Sets the agreed contract value.',
  'change-orders':
    'Approved change orders. Each one bumps the project contract value.',
  invoices: 'Progress / milestone / final billings tied to projects.',
  payments: 'Customer payments applied to invoices. Partial payments allowed.',
  'purchase-orders':
    'Vendor commitments + landed-cost imports for material spend.',
  retainage: 'Retainage releases against held retainage on invoices.',
};

// ===== Date helpers =====

function parseISO(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

const CUTOFF = parseISO(BACKFILL_CUTOFF_ISO);

function isAfterCutoff(d: string | Date | null | undefined): boolean {
  if (!d) return false;
  const dt = typeof d === 'string' ? parseISO(d) : d;
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() >= CUTOFF.getTime();
}

function todayUTC(asOf: Date = new Date()): Date {
  return new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
}

function daysBetween(fromISO: string, asOf: Date = new Date()): number {
  return Math.floor(
    (todayUTC(asOf).getTime() - parseISO(fromISO).getTime()) / 86_400_000,
  );
}

// ===== Step counts =====

export type BackfillStepCounts = Record<BackfillStep, number>;

/**
 * Returns the number of records entered for each step since the cutoff date.
 * Counts use entity-specific dates where it makes sense (e.g. invoiceDate for
 * invoices) and fall back to createdAt otherwise.
 */
export async function getBackfillStepCounts(
  companyId: string,
): Promise<BackfillStepCounts> {
  const [
    customers,
    projects,
    estimates,
    proposals,
    changeOrders,
    invoices,
    payments,
    purchaseOrders,
    retainageReleases,
  ] = await Promise.all([
    listCustomers(companyId),
    listProjects(companyId),
    listEstimates(companyId),
    listProposals(companyId),
    listChangeOrders(companyId),
    listInvoices(companyId),
    listPayments(companyId),
    listPurchaseOrders(companyId),
    listRetainageReleases(companyId),
  ]);

  return {
    customers: customers.filter((c) => isAfterCutoff(c.createdAt)).length,
    projects: projects.filter(
      (p) => isAfterCutoff(p.startDate) || isAfterCutoff(p.createdAt),
    ).length,
    proposals:
      estimates.filter(
        (e) => isAfterCutoff(e.submittedAt) || isAfterCutoff(e.createdAt),
      ).length +
      proposals.filter(
        (p) =>
          isAfterCutoff(p.proposalDate) ||
          isAfterCutoff(p.sentAt) ||
          isAfterCutoff(p.createdAt),
      ).length,
    'change-orders': changeOrders.filter(
      (c) =>
        isAfterCutoff(c.submittedAt) ||
        isAfterCutoff(c.approvedAt) ||
        isAfterCutoff(c.createdAt),
    ).length,
    invoices: invoices.filter((i) => isAfterCutoff(i.invoiceDate)).length,
    payments: payments.filter((p) => isAfterCutoff(p.paidDate)).length,
    'purchase-orders': purchaseOrders.filter(
      (po) => isAfterCutoff(po.issueDate) || isAfterCutoff(po.createdAt),
    ).length,
    retainage: retainageReleases.filter((r) => isAfterCutoff(r.releaseDate))
      .length,
  };
}

// ===== KPI rollup (review page) =====

export type BackfillKPIs = {
  totalContractValue: number;
  totalInvoiced: number;
  totalPaid: number;
  outstandingAR: number;
  retainageHeld: number;
  retainageReleased: number;
  retainageOutstanding: number;
  openPurchaseOrders: number;
  openPurchaseOrderValue: number;
  landedCostTotal: number;
  changeOrdersApprovedTotal: number;
};

export async function getBackfillKPIs(companyId: string): Promise<BackfillKPIs> {
  const [
    projects,
    invoices,
    payments,
    purchaseOrders,
    landedCosts,
    changeOrders,
  ] = await Promise.all([
    listProjects(companyId),
    listInvoices(companyId),
    listPayments(companyId),
    listPurchaseOrders(companyId),
    listLandedCosts(companyId),
    listChangeOrders(companyId),
  ]);

  const totalContractValue = projects.reduce(
    (acc, p) => add(acc, parseMoney(p.contractValue)),
    0,
  );

  let totalInvoiced = 0;
  let totalPaid = 0;
  let retainageHeld = 0;
  let retainageReleased = 0;
  for (const inv of invoices) {
    if (normalizeStatus('invoice', inv.status) === 'void') continue;
    totalInvoiced = add(totalInvoiced, parseMoney(inv.total));
    totalPaid = add(totalPaid, parseMoney(inv.amountPaid));
    retainageHeld = add(retainageHeld, parseMoney(inv.retainageAmount));
    retainageReleased = add(
      retainageReleased,
      parseMoney(inv.retainageReleased),
    );
  }
  void payments;

  let openPurchaseOrders = 0;
  let openPurchaseOrderValue = 0;
  for (const po of purchaseOrders) {
    const c = normalizeStatus('purchase_order', po.status);
    if (c === 'void' || c === 'closed' || c === 'received') continue;
    openPurchaseOrders += 1;
    openPurchaseOrderValue = add(openPurchaseOrderValue, parseMoney(po.total));
  }

  const landedCostTotal = landedCosts.reduce(
    (acc, l) => add(acc, parseMoney(l.totalLandedCost)),
    0,
  );

  const changeOrdersApprovedTotal = changeOrders
    .filter((c) => normalizeStatus('change_order', c.status) === 'approved')
    .reduce((acc, c) => add(acc, parseMoney(c.total)), 0);

  return {
    totalContractValue,
    totalInvoiced,
    totalPaid,
    outstandingAR: subtract(totalInvoiced, totalPaid),
    retainageHeld,
    retainageReleased,
    retainageOutstanding: subtract(retainageHeld, retainageReleased),
    openPurchaseOrders,
    openPurchaseOrderValue,
    landedCostTotal,
    changeOrdersApprovedTotal,
  };
}

// ===== Warnings =====

export type BackfillWarning = {
  severity: 'warn' | 'info';
  category:
    | 'missing-link'
    | 'unresolved-balance'
    | 'incomplete-project'
    | 'data-quality';
  message: string;
  href?: string;
};

export async function getBackfillWarnings(
  companyId: string,
): Promise<BackfillWarning[]> {
  const [
    projects,
    estimates,
    proposals,
    changeOrders,
    invoices,
    payments,
    purchaseOrders,
  ] = await Promise.all([
    listProjects(companyId),
    listEstimates(companyId),
    listProposals(companyId),
    listChangeOrders(companyId),
    listInvoices(companyId),
    listPayments(companyId),
    listPurchaseOrders(companyId),
  ]);

  const warnings: BackfillWarning[] = [];

  // Projects with no estimate
  const estimateProjectIds = new Set(estimates.map((e) => e.projectId));
  for (const p of projects) {
    if (!estimateProjectIds.has(p.id)) {
      warnings.push({
        severity: 'info',
        category: 'incomplete-project',
        message: `${p.number} — ${p.name}: no estimate on file`,
        href: `/projects/${p.id}`,
      });
    }
  }

  // Approved proposals with no associated invoice (missing initial billing).
  const invoicedProjectIds = new Set(invoices.map((i) => i.projectId));
  for (const p of proposals) {
    const c = normalizeStatus('proposal', p.status);
    if (c !== 'approved') continue;
    if (!invoicedProjectIds.has(p.projectId)) {
      warnings.push({
        severity: 'info',
        category: 'incomplete-project',
        message: `Proposal ${p.number} approved but the project has no invoices yet`,
        href: `/proposals/${p.id}`,
      });
    }
  }

  // Approved change orders with no follow-on invoice
  for (const co of changeOrders) {
    const c = normalizeStatus('change_order', co.status);
    if (c !== 'approved') continue;
    const followOn = invoices.some((i) => i.changeOrderId === co.id);
    if (!followOn) {
      warnings.push({
        severity: 'info',
        category: 'incomplete-project',
        message: `Approved CO ${co.number} has no invoice yet`,
        href: `/change-orders/${co.id}`,
      });
    }
  }

  // Overdue / unresolved invoice balances
  const today = new Date();
  for (const inv of invoices) {
    const c = normalizeStatus('invoice', inv.status);
    if (c === 'void' || c === 'paid') continue;
    const balance = subtract(parseMoney(inv.total), parseMoney(inv.amountPaid));
    if (balance > 0 && inv.dueDate) {
      const daysLate = daysBetween(inv.dueDate, today);
      if (daysLate > 0) {
        warnings.push({
          severity: 'warn',
          category: 'unresolved-balance',
          message: `Invoice ${inv.number} is ${daysLate} day${daysLate === 1 ? '' : 's'} past due (balance $${balance.toFixed(2)})`,
          href: `/invoices/${inv.id}`,
        });
      }
    }
  }

  // Payments referencing invoices that don't exist (FK already prevents this
  // in DB, but in mock mode it's possible if the user manually crafts data)
  const invoiceIds = new Set(invoices.map((i) => i.id));
  for (const p of payments) {
    if (!invoiceIds.has(p.invoiceId)) {
      warnings.push({
        severity: 'warn',
        category: 'missing-link',
        message: `Payment ${p.paymentNumber || p.id} is missing its invoice`,
        href: `/payments/${p.id}`,
      });
    }
  }

  // POs not yet received (informational)
  for (const po of purchaseOrders) {
    const c = normalizeStatus('purchase_order', po.status);
    if (c === 'issued' || c === 'partially_received' || c === 'draft') {
      warnings.push({
        severity: 'info',
        category: 'unresolved-balance',
        message: `PO ${po.number} is ${c} — not yet fully received`,
        href: `/purchase-orders/${po.id}`,
      });
    }
  }

  return warnings;
}

// ===== Per-project completion =====

export type ProjectBackfillStatus = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  hasEstimate: boolean;
  hasProposal: boolean;
  hasInvoice: boolean;
  hasPayment: boolean;
  complete: boolean;
};

export async function getProjectBackfillStatuses(
  companyId: string,
): Promise<ProjectBackfillStatus[]> {
  const [projects, estimates, proposals, invoices, payments] = await Promise.all([
    listProjects(companyId),
    listEstimates(companyId),
    listProposals(companyId),
    listInvoices(companyId),
    listPayments(companyId),
  ]);
  const invoicesByProject = new Map<string, string[]>();
  for (const inv of invoices) {
    const arr = invoicesByProject.get(inv.projectId) ?? [];
    arr.push(inv.id);
    invoicesByProject.set(inv.projectId, arr);
  }
  const paymentInvoiceIds = new Set(payments.map((p) => p.invoiceId));

  return projects.map((p) => {
    const hasEstimate = estimates.some((e) => e.projectId === p.id);
    const hasProposal = proposals.some((pr) => pr.projectId === p.id);
    const projInvoiceIds = invoicesByProject.get(p.id) ?? [];
    const hasInvoice = projInvoiceIds.length > 0;
    const hasPayment = projInvoiceIds.some((id) => paymentInvoiceIds.has(id));
    const complete = hasEstimate && hasInvoice;
    return {
      projectId: p.id,
      projectNumber: p.number,
      projectName: p.name,
      hasEstimate,
      hasProposal,
      hasInvoice,
      hasPayment,
      complete,
    };
  });
}
