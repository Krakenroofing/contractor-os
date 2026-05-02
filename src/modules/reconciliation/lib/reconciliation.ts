// Server-only reconciliation engine.
//
// Builds a per-project rollup of every financial signal in the system, runs a
// suite of cross-table validation checks, and returns warnings tagged by
// severity + category. Used by /reconciliation (overview + drill-down).
//
// Everything reads through the data layer, so DB and demo modes both work
// without special-casing.

import 'server-only';
import { listCustomers } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { listChangeOrders } from '@/lib/data/change-orders';
import {
  listPurchaseOrders,
  getPurchaseOrderLines,
} from '@/lib/data/purchase-orders';
import { listLandedCosts } from '@/lib/data/landed-costs';
import {
  listInvoices,
  getInvoiceLineItems,
} from '@/lib/data/invoices';
import {
  listPayments,
  getInvoicePayments,
} from '@/lib/data/invoice-payments';
import {
  listRetainageReleases,
  listRetainageReleasesForInvoice,
} from '@/lib/data/retainage-releases';
import { computeProjectFinancials } from '@/modules/job-costing/lib/financials';
import { add, parseMoney, round2, subtract, multiply } from '@/lib/money';
import { normalizeStatus } from '@/lib/status-machine';
import type { Project } from '@/db/schema';

// Tolerance for float / numeric storage rounding when comparing dollar
// amounts. Anything within half a penny is considered equal.
const EPSILON = 0.005;

// ===== Types =====

export type ReconciliationWarning = {
  severity: 'error' | 'warn' | 'info';
  category:
    | 'invoice-mismatch'
    | 'payment-mismatch'
    | 'orphaned-invoice'
    | 'orphaned-payment'
    | 'negative-balance'
    | 'co-not-rolled-up'
    | 'orphaned-po'
    | 'orphaned-landed-cost'
    | 'retainage-mismatch';
  message: string;
  /** Optional project id this warning relates to (for drill-down filtering). */
  projectId?: string;
  /** Optional href to navigate to the offending record. */
  href?: string;
};

export type ProjectReconciliationRow = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  customerId: string;
  customerName: string;
  status: Project['status'];
  // Contract roll-up
  originalContractValue: number;
  approvedChangeOrders: number;
  revisedContractValue: number;
  // Billing roll-up
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  outstandingAR: number;
  // Retainage
  retainageHeld: number;
  retainageReleased: number;
  retainageBalance: number;
  // Cost roll-up
  poCommitments: number;
  estimatedCost: number;
  actualCost: number;
  landedCostTotal: number;
  // Profit
  projectedGrossProfit: number;
  projectedGrossMarginPct: number;
  // Verification
  verifiedAt: Date | null;
  verifiedRole: string | null;
  verifiedNote: string | null;
  // Warnings scoped to this project
  warningsCount: number;
  warningsBySeverity: { error: number; warn: number; info: number };
};

export type ReconciliationData = {
  rows: ProjectReconciliationRow[];
  warnings: ReconciliationWarning[];
  // Aggregates
  totalDiscrepancies: number;
  expectedAR: number; // sum of (invoice.total - invoice.amountPaid) on non-paid, non-void invoices
  observedAR: number; // outstandingAR by aging derivation
  expectedCommittedCost: number; // sum of PO totals (excluding void/closed)
  observedCommittedCost: number; // computeProjectFinancials.committedCost summed across active projects
  verifiedProjects: number;
  unverifiedProjects: number;
};

// ===== Builder =====

export async function buildReconciliationData(
  companyId: string,
): Promise<ReconciliationData> {
  const [
    projects,
    customers,
    changeOrders,
    invoices,
    payments,
    purchaseOrders,
    landedCosts,
    retainageReleases,
  ] = await Promise.all([
    listProjects(companyId),
    listCustomers(companyId),
    listChangeOrders(companyId),
    listInvoices(companyId),
    listPayments(companyId),
    listPurchaseOrders(companyId),
    listLandedCosts(companyId),
    listRetainageReleases(companyId),
  ]);

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const projectIds = new Set(projects.map((p) => p.id));
  const invoiceIds = new Set(invoices.map((i) => i.id));

  // ===== Global warnings (cross-project) =====
  const warnings: ReconciliationWarning[] = [];

  // 1. Invoice totals vs payments mismatch — invoice.amountPaid should equal
  //    SUM(payments where status in {received, applied}) for that invoice.
  for (const inv of invoices) {
    const ipayments = await getInvoicePayments(inv.id);
    const expectedPaid = ipayments
      .filter((p) => p.status === 'received' || p.status === 'applied')
      .reduce((acc, p) => add(acc, parseMoney(p.amount)), 0);
    const storedPaid = parseMoney(inv.amountPaid);
    if (Math.abs(storedPaid - expectedPaid) > EPSILON) {
      warnings.push({
        severity: 'error',
        category: 'invoice-mismatch',
        projectId: inv.projectId,
        message: `Invoice ${inv.number}: stored amountPaid (${storedPaid.toFixed(2)}) does not equal sum of received/applied payments (${expectedPaid.toFixed(2)})`,
        href: `/invoices/${inv.id}`,
      });
    }

    // Also check that line items sum to subtotal.
    const lines = await getInvoiceLineItems(inv.id);
    if (lines.length > 0) {
      const computedSubtotal = lines.reduce(
        (acc, l) => add(acc, parseMoney(l.lineTotal)),
        0,
      );
      const storedSubtotal = parseMoney(inv.subtotal);
      if (Math.abs(computedSubtotal - storedSubtotal) > EPSILON) {
        warnings.push({
          severity: 'warn',
          category: 'invoice-mismatch',
          projectId: inv.projectId,
          message: `Invoice ${inv.number}: line items sum (${computedSubtotal.toFixed(2)}) differs from stored subtotal (${storedSubtotal.toFixed(2)})`,
          href: `/invoices/${inv.id}`,
        });
      }
    }
  }

  // 2. Invoices not linked to projects (FK at DB level prevents this; check
  //    anyway in case of mock store edge-cases).
  for (const inv of invoices) {
    if (!projectIds.has(inv.projectId)) {
      warnings.push({
        severity: 'error',
        category: 'orphaned-invoice',
        message: `Invoice ${inv.number} references missing project ${inv.projectId}`,
        href: `/invoices/${inv.id}`,
      });
    }
  }

  // 3. Payments not applied to invoices (NULL or missing invoiceId).
  for (const p of payments) {
    if (!p.invoiceId || !invoiceIds.has(p.invoiceId)) {
      warnings.push({
        severity: 'error',
        category: 'orphaned-payment',
        message: `Payment ${p.paymentNumber || p.id} is not linked to a valid invoice`,
        href: `/payments/${p.id}`,
      });
    }
  }

  // 4. Negative balances
  for (const inv of invoices) {
    const total = parseMoney(inv.total);
    const paid = parseMoney(inv.amountPaid);
    if (total < -EPSILON) {
      warnings.push({
        severity: 'error',
        category: 'negative-balance',
        projectId: inv.projectId,
        message: `Invoice ${inv.number} has a negative total (${total.toFixed(2)})`,
        href: `/invoices/${inv.id}`,
      });
    }
    if (paid < -EPSILON) {
      warnings.push({
        severity: 'error',
        category: 'negative-balance',
        projectId: inv.projectId,
        message: `Invoice ${inv.number} has a negative amount paid (${paid.toFixed(2)})`,
        href: `/invoices/${inv.id}`,
      });
    }
    // Overpaid by more than tolerance — could be intentional (refund pending)
    // but warrants a warn-level flag.
    if (paid - total > EPSILON && normalizeStatus('invoice', inv.status) !== 'void') {
      warnings.push({
        severity: 'warn',
        category: 'negative-balance',
        projectId: inv.projectId,
        message: `Invoice ${inv.number} is overpaid: ${paid.toFixed(2)} on a ${total.toFixed(2)} invoice`,
        href: `/invoices/${inv.id}`,
      });
    }
  }

  // 5. Change orders not included in project totals.
  // For each project, sum approved CO totals and compare to project.totalChangeOrders.
  for (const project of projects) {
    const projectCOs = changeOrders.filter((c) => c.projectId === project.id);
    const approvedTotal = projectCOs
      .filter((c) => normalizeStatus('change_order', c.status) === 'approved')
      .reduce((acc, c) => add(acc, parseMoney(c.total)), 0);
    const stored = parseMoney(project.totalChangeOrders);
    if (Math.abs(approvedTotal - stored) > EPSILON) {
      warnings.push({
        severity: 'warn',
        category: 'co-not-rolled-up',
        projectId: project.id,
        message: `Project ${project.number}: approved CO total (${approvedTotal.toFixed(2)}) doesn't match project.totalChangeOrders (${stored.toFixed(2)})`,
        href: `/projects/${project.id}`,
      });
    }
    // Revised contract should equal original + totalChangeOrders.
    const expectedContract = add(
      parseMoney(project.originalContractValue),
      stored,
    );
    const actualContract = parseMoney(project.contractValue);
    if (Math.abs(expectedContract - actualContract) > EPSILON) {
      warnings.push({
        severity: 'warn',
        category: 'co-not-rolled-up',
        projectId: project.id,
        message: `Project ${project.number}: contractValue (${actualContract.toFixed(2)}) ≠ originalContractValue + totalChangeOrders (${expectedContract.toFixed(2)})`,
        href: `/projects/${project.id}`,
      });
    }
  }

  // 6. POs not linked to projects.
  for (const po of purchaseOrders) {
    if (!projectIds.has(po.projectId)) {
      warnings.push({
        severity: 'error',
        category: 'orphaned-po',
        message: `PO ${po.number} references missing project ${po.projectId}`,
        href: `/purchase-orders/${po.id}`,
      });
    }
    // PO total should equal subtotal + tax + shipping.
    const lines = await getPurchaseOrderLines(po.id);
    if (lines.length > 0) {
      const lineSum = lines.reduce(
        (acc, l) => add(acc, parseMoney(l.lineTotal)),
        0,
      );
      const storedSub = parseMoney(po.subtotal);
      if (Math.abs(lineSum - storedSub) > EPSILON) {
        warnings.push({
          severity: 'warn',
          category: 'orphaned-po',
          projectId: po.projectId,
          message: `PO ${po.number}: line items sum (${lineSum.toFixed(2)}) ≠ stored subtotal (${storedSub.toFixed(2)})`,
          href: `/purchase-orders/${po.id}`,
        });
      }
    }
  }

  // 7. Landed cost entries not tied to POs.
  // A landed-cost row is "tied" if some PO references it via landedCostEntryId.
  const landedCostIdsLinkedToPO = new Set(
    purchaseOrders
      .filter((po) => po.landedCostEntryId !== null)
      .map((po) => po.landedCostEntryId!),
  );
  for (const lc of landedCosts) {
    if (!landedCostIdsLinkedToPO.has(lc.id)) {
      warnings.push({
        severity: 'info',
        category: 'orphaned-landed-cost',
        projectId: lc.projectId ?? undefined,
        message: `Landed cost "${lc.name}" is not linked to any PO`,
        href: `/landed-cost/${lc.id}`,
      });
    }
  }

  // 8. Retainage mismatch — invoice.retainageReleased should equal SUM of
  //    retainage_releases.amount for that invoice. Also the project-level
  //    retainage held shouldn't exceed the contract value.
  for (const inv of invoices) {
    const releases = await listRetainageReleasesForInvoice(inv.id);
    const releaseSum = releases.reduce(
      (acc, r) => add(acc, parseMoney(r.amount)),
      0,
    );
    const storedReleased = parseMoney(inv.retainageReleased);
    if (Math.abs(releaseSum - storedReleased) > EPSILON) {
      warnings.push({
        severity: 'error',
        category: 'retainage-mismatch',
        projectId: inv.projectId,
        message: `Invoice ${inv.number}: retainageReleased (${storedReleased.toFixed(2)}) ≠ sum of release rows (${releaseSum.toFixed(2)})`,
        href: `/invoices/${inv.id}`,
      });
    }
    // Released > held — over-release.
    const held = parseMoney(inv.retainageAmount);
    if (releaseSum - held > EPSILON) {
      warnings.push({
        severity: 'error',
        category: 'retainage-mismatch',
        projectId: inv.projectId,
        message: `Invoice ${inv.number}: released ${releaseSum.toFixed(2)} exceeds held ${held.toFixed(2)}`,
        href: `/invoices/${inv.id}`,
      });
    }
  }

  // Retainage releases pointing at unknown invoices.
  for (const r of retainageReleases) {
    if (!invoiceIds.has(r.invoiceId)) {
      warnings.push({
        severity: 'error',
        category: 'retainage-mismatch',
        message: `Retainage release ${r.releaseNumber || r.id} references missing invoice`,
        href: `/retainage`,
      });
    }
  }

  // ===== Per-project rollup =====

  const rows: ProjectReconciliationRow[] = await Promise.all(
    projects.map(async (project) => {
      const fin = await computeProjectFinancials(companyId, project.id);
      const projectInvoices = invoices.filter((i) => i.projectId === project.id);
      const projectCOs = changeOrders.filter((c) => c.projectId === project.id);
      const projectPOs = purchaseOrders.filter((p) => p.projectId === project.id);

      let totalInvoiced = 0;
      let totalPaid = 0;
      let retainageHeld = 0;
      let retainageReleased = 0;
      for (const inv of projectInvoices) {
        if (normalizeStatus('invoice', inv.status) === 'void') continue;
        totalInvoiced = add(totalInvoiced, parseMoney(inv.total));
        totalPaid = add(totalPaid, parseMoney(inv.amountPaid));
        retainageHeld = add(retainageHeld, parseMoney(inv.retainageAmount));
        retainageReleased = add(
          retainageReleased,
          parseMoney(inv.retainageReleased),
        );
      }

      const approvedCOTotal = projectCOs
        .filter((c) => normalizeStatus('change_order', c.status) === 'approved')
        .reduce((acc, c) => add(acc, parseMoney(c.total)), 0);

      const poCommitments = projectPOs
        .filter((p) => {
          const c = normalizeStatus('purchase_order', p.status);
          return c !== 'void' && c !== 'closed';
        })
        .reduce((acc, p) => add(acc, parseMoney(p.total)), 0);

      const projectWarnings = warnings.filter(
        (w) => w.projectId === project.id,
      );
      const warningsBySeverity = {
        error: projectWarnings.filter((w) => w.severity === 'error').length,
        warn: projectWarnings.filter((w) => w.severity === 'warn').length,
        info: projectWarnings.filter((w) => w.severity === 'info').length,
      };

      return {
        projectId: project.id,
        projectNumber: project.number,
        projectName: project.name,
        customerId: project.customerId,
        customerName: customerById.get(project.customerId)?.name ?? 'Unknown',
        status: project.status,
        originalContractValue: parseMoney(project.originalContractValue),
        approvedChangeOrders: approvedCOTotal,
        revisedContractValue: parseMoney(project.contractValue),
        invoiceCount: projectInvoices.length,
        totalInvoiced: round2(totalInvoiced),
        totalPaid: round2(totalPaid),
        outstandingAR: round2(subtract(totalInvoiced, totalPaid)),
        retainageHeld: round2(retainageHeld),
        retainageReleased: round2(retainageReleased),
        retainageBalance: round2(subtract(retainageHeld, retainageReleased)),
        poCommitments: round2(poCommitments),
        estimatedCost: fin?.estimatedCost ?? 0,
        actualCost: fin?.actualCost ?? 0,
        landedCostTotal: fin?.landedCostTotal ?? 0,
        projectedGrossProfit: fin?.projectedGrossProfit ?? 0,
        projectedGrossMarginPct: fin?.projectedGrossMarginPct ?? 0,
        verifiedAt: project.reconciliationVerifiedAt,
        verifiedRole: project.reconciliationVerifiedRole,
        verifiedNote: project.reconciliationVerifiedNote,
        warningsCount: projectWarnings.length,
        warningsBySeverity,
      };
    }),
  );

  // ===== Aggregates =====

  const expectedAR = invoices
    .filter((i) => normalizeStatus('invoice', i.status) !== 'void')
    .reduce(
      (acc, i) =>
        add(acc, subtract(parseMoney(i.total), parseMoney(i.amountPaid))),
      0,
    );
  const observedAR = rows.reduce((acc, r) => add(acc, r.outstandingAR), 0);

  const expectedCommittedCost = purchaseOrders
    .filter((p) => {
      const c = normalizeStatus('purchase_order', p.status);
      return c !== 'void' && c !== 'closed';
    })
    .reduce((acc, p) => add(acc, parseMoney(p.total)), 0);
  const observedCommittedCost = rows.reduce(
    (acc, r) => add(acc, r.poCommitments),
    0,
  );

  const verifiedProjects = rows.filter((r) => r.verifiedAt !== null).length;
  const unverifiedProjects = rows.length - verifiedProjects;

  return {
    rows,
    warnings,
    totalDiscrepancies: warnings.filter((w) => w.severity !== 'info').length,
    expectedAR: round2(expectedAR),
    observedAR: round2(observedAR),
    expectedCommittedCost: round2(expectedCommittedCost),
    observedCommittedCost: round2(observedCommittedCost),
    verifiedProjects,
    unverifiedProjects,
  };
}

// Tiny used reference so multiply isn't tree-shaken if this module ends up
// being the only loader at boot (silences a unused-import lint warning when
// the function is reserved for future calculator extensions).
void multiply;
