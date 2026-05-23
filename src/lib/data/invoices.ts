// Async data accessor for invoices (header + line items + project summary).
//
// Status timestamps (sentAt / paidAt) and the cumulative payment-state
// recompute live in @/lib/mock-store / @/lib/data/invoice-payments — this
// module is just CRUD.

import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  invoiceLineItems,
  invoicePayments,
  invoices,
  type Invoice,
  type InvoiceLineItem,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  computeInvoiceVatSplit,
  groupPaymentsByInvoice,
} from '@/modules/invoices/lib/financials';
import { parseMoney } from '@/lib/money';
import {
  listMockInvoices as mockList,
  getMockInvoice as mockGet,
  getMockInvoiceLineItems as mockGetLines,
  listInvoicesForProject as mockListForProject,
  createMockInvoice as mockCreate,
  updateMockInvoiceHeader as mockUpdateHeader,
  updateMockInvoiceFull as mockUpdateFull,
  deleteMockDraftInvoice as mockDeleteDraft,
  computeProjectInvoiceSummary as mockComputeSummary,
  DuplicateInvoiceNumberError,
  type CreateInvoiceInput,
  type ProjectInvoiceSummary,
} from '@/lib/mock-store';
import { recomputeInvoicePaymentState } from '@/lib/data/invoice-payments';

export { DuplicateInvoiceNumberError };
export type { CreateInvoiceInput, ProjectInvoiceSummary };

export async function listInvoices(companyId: string): Promise<Invoice[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.createdAt));
  }
  return mockList(companyId);
}

export async function getInvoice(
  companyId: string,
  id: string,
): Promise<Invoice | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function getInvoiceLineItems(
  invoiceId: string,
): Promise<InvoiceLineItem[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(asc(invoiceLineItems.sortOrder));
  }
  return mockGetLines(invoiceId);
}

export async function listInvoicesForProject(
  projectId: string,
): Promise<Invoice[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.projectId, projectId))
      .orderBy(desc(invoices.createdAt));
  }
  return mockListForProject(projectId);
}

export async function createInvoice(
  companyId: string,
  input: CreateInvoiceInput,
): Promise<Invoice> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const existing = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.number, input.number)))
      .limit(1);
    if (existing.length > 0) throw new DuplicateInvoiceNumberError();

    const now = new Date();
    const inserted = await db
      .insert(invoices)
      .values({
        companyId,
        projectId: input.projectId,
        proposalId: input.proposalId,
        changeOrderId: input.changeOrderId,
        templateId: input.templateId,
        number: input.number,
        status: input.status,
        billingType: input.billingType,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        subtotal: input.subtotal,
        taxAmount: input.taxAmount,
        retainagePercent: input.retainagePercent ?? '0.000',
        retainageAmount: input.retainageAmount,
        retainageReleased: input.retainageReleased ?? '0.00',
        expectedRetainageReleaseDate: input.expectedRetainageReleaseDate ?? null,
        total: input.total,
        amountPaid: input.amountPaid,
        notes: input.notes,
        termsOverride: input.termsOverride,
        purchaseOrderNumber: input.purchaseOrderNumber ?? null,
        billingLabel: input.billingLabel ?? null,
        percentOfContract: input.percentOfContract ?? null,
        sentAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
        paidAt: input.status === 'paid' ? now : null,
      })
      .returning();
    const inv = inserted[0];

    if (input.lines.length > 0) {
      await db.insert(invoiceLineItems).values(
        input.lines.map((l, i) => ({
          invoiceId: inv.id,
          costCodeId: l.costCodeId,
          inventoryItemId: l.inventoryItemId ?? null,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
          sortOrder: i,
        })),
      );
    }

    return inv;
  }
  return mockCreate(companyId, input);
}

/**
 * Header-only update — invoice metadata (dates, billing type, notes,
 * terms override). Line items, totals, retainage release tracking, and
 * payment-driven status are NOT touched here. Edit only allowed while
 * the invoice is still `draft`; the action layer enforces that.
 */
export type UpdateInvoiceHeaderInput = {
  invoiceDate: string;
  dueDate: string | null;
  billingType: Invoice['billingType'];
  notes: string | null;
  termsOverride: string | null;
  expectedRetainageReleaseDate: string | null;
};

export async function updateInvoiceHeader(
  companyId: string,
  id: string,
  patch: UpdateInvoiceHeaderInput,
): Promise<Invoice | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(invoices)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .returning();
    return rows[0];
  }
  return mockUpdateHeader(companyId, id, patch);
}

/**
 * Full-form invoice update: lines + totals + retainage + tax + dates +
 * notes. Customer/project/invoice-number are intentionally NOT in the
 * patch — those changes are forbidden via the action layer because they
 * silently break the audit trail. Existing payments stay linked; after
 * the patch lands we re-run `recomputeInvoicePaymentState` so amount_paid
 * and the derived status reflect the new total.
 */
export type UpdateInvoiceFullInput = {
  billingType: Invoice['billingType'];
  /** Reclassification: which change order this invoice bills against. Null
   *  means "base contract". Editable post-send because the link drives
   *  reporting only — it doesn't change the money on the invoice. */
  changeOrderId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  subtotal: string;
  taxAmount: string;
  retainagePercent: string;
  retainageAmount: string;
  expectedRetainageReleaseDate: string | null;
  total: string;
  notes: string | null;
  termsOverride: string | null;
  purchaseOrderNumber: string | null;
  billingLabel: string | null;
  percentOfContract: string | null;
  lines: Array<{
    costCodeId: string | null;
    inventoryItemId?: string | null;
    description: string;
    unit: string | null;
    quantity: string;
    unitCost: string;
    lineTotal: string;
  }>;
};

export async function updateInvoiceFull(
  companyId: string,
  id: string,
  patch: UpdateInvoiceFullInput,
): Promise<Invoice | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Verify ownership before mutating anything.
    const existing = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .limit(1);
    if (existing.length === 0) return undefined;

    // Replace line items in-place: delete old, insert new. Keeping the
    // invoice row's id stable means existing payment FKs are preserved.
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));
    if (patch.lines.length > 0) {
      await db.insert(invoiceLineItems).values(
        patch.lines.map((l, i) => ({
          invoiceId: id,
          costCodeId: l.costCodeId,
          inventoryItemId: l.inventoryItemId ?? null,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
          sortOrder: i,
        })),
      );
    }

    await db
      .update(invoices)
      .set({
        billingType: patch.billingType,
        changeOrderId: patch.changeOrderId,
        invoiceDate: patch.invoiceDate,
        dueDate: patch.dueDate,
        subtotal: patch.subtotal,
        taxAmount: patch.taxAmount,
        retainagePercent: patch.retainagePercent,
        retainageAmount: patch.retainageAmount,
        expectedRetainageReleaseDate: patch.expectedRetainageReleaseDate,
        total: patch.total,
        notes: patch.notes,
        termsOverride: patch.termsOverride,
        purchaseOrderNumber: patch.purchaseOrderNumber,
        billingLabel: patch.billingLabel,
        percentOfContract: patch.percentOfContract,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));

    // Re-derive amount_paid + status against the new total. If the new
    // total is below the sum of payments, status auto-flips to 'paid';
    // if above, it drops to 'partial' or 'sent'.
    await recomputeInvoicePaymentState(id);

    const fresh = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return fresh[0];
  }
  return mockUpdateFull(companyId, id, patch);
}

/**
 * Hard-delete a draft invoice. Returns false if the invoice has any payment
 * rows or retainage releases — those callers must use the void transition
 * instead so history is preserved.
 */
export async function deleteDraftInvoice(
  companyId: string,
  id: string,
): Promise<boolean> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const inv = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .limit(1);
    if (inv.length === 0) return false;
    if (inv[0].status !== 'draft') return false;

    // Refuse delete when payments exist. Retainage releases are FK-protected
    // by `onDelete: 'restrict'`, so we let the database enforce that path.
    const pays = await db
      .select({ id: invoicePayments.id })
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, id))
      .limit(1);
    if (pays.length > 0) return false;

    // line items cascade via onDelete: 'cascade'. retainage_releases is
    // restrict; if a stray release exists we surface the FK error.
    await db.delete(invoices).where(eq(invoices.id, id));
    return true;
  }
  return mockDeleteDraft(companyId, id);
}

/**
 * Per-source bucket of invoice activity on a project. `changeOrderId` is
 * null when the bucket represents billing against the base contract
 * (invoices created without a linked change order).
 */
export type ProjectInvoiceSourceBucket = {
  changeOrderId: string | null;
  invoiceCount: number;
  totalInvoiced: number;
  /** Sum of invoice subtotals in this bucket (revenue, ex-VAT). */
  totalInvoicedNet: number;
  /** Sum of invoice taxAmount in this bucket. */
  totalInvoicedVat: number;
  totalPaid: number;
  /** Portion of paid attributable to revenue. */
  totalPaidNet: number;
  /** Portion of paid attributable to VAT (a liability). */
  totalPaidVat: number;
  outstandingBalance: number;
  /** Outstanding revenue not yet realized. */
  outstandingBalanceNet: number;
  /** Outstanding VAT not yet collected. */
  outstandingBalanceVat: number;
  retainageHeld: number;
  retainageReleased: number;
  retainageBalance: number;
};

export type ProjectInvoicesByContractSource = {
  base: ProjectInvoiceSourceBucket;
  byChangeOrder: ProjectInvoiceSourceBucket[];
};

function emptyBucket(changeOrderId: string | null): ProjectInvoiceSourceBucket {
  return {
    changeOrderId,
    invoiceCount: 0,
    totalInvoiced: 0,
    totalInvoicedNet: 0,
    totalInvoicedVat: 0,
    totalPaid: 0,
    totalPaidNet: 0,
    totalPaidVat: 0,
    outstandingBalance: 0,
    outstandingBalanceNet: 0,
    outstandingBalanceVat: 0,
    retainageHeld: 0,
    retainageReleased: 0,
    retainageBalance: 0,
  };
}

/**
 * Split a project's invoice activity into base-contract billings vs.
 * billings tagged to a specific change order. Voided invoices are excluded
 * from every bucket (they never hit the bank). Each bucket carries the full
 * net/VAT/gross decomposition so customer- and dashboard-level rollups can
 * sub-split base vs CO without re-deriving from raw invoices.
 */
export async function computeProjectInvoicesByContractSource(
  projectId: string,
): Promise<ProjectInvoicesByContractSource> {
  const invs = await listInvoicesForProject(projectId);
  const nonVoid = invs.filter((i) => i.status !== 'void');
  const paymentsByInvoice = new Map<string, Awaited<ReturnType<typeof import('./invoice-payments').getInvoicePayments>>>();
  await Promise.all(
    nonVoid.map(async (inv) => {
      const { getInvoicePayments } = await import('./invoice-payments');
      paymentsByInvoice.set(inv.id, await getInvoicePayments(inv.id));
    }),
  );
  const base = emptyBucket(null);
  const byCoMap = new Map<string, ProjectInvoiceSourceBucket>();
  for (const inv of nonVoid) {
    const bucket = inv.changeOrderId
      ? (byCoMap.get(inv.changeOrderId) ?? emptyBucket(inv.changeOrderId))
      : base;
    const split = computeInvoiceVatSplit(inv, paymentsByInvoice.get(inv.id) ?? []);
    bucket.invoiceCount += 1;
    bucket.totalInvoiced += split.gross;
    bucket.totalInvoicedNet += split.net;
    bucket.totalInvoicedVat += split.vat;
    bucket.totalPaid += split.paidGross;
    bucket.totalPaidNet += split.paidNet;
    bucket.totalPaidVat += split.paidVat;
    bucket.outstandingBalance += split.balanceGross;
    bucket.outstandingBalanceNet += split.balanceNet;
    bucket.outstandingBalanceVat += split.balanceVat;
    bucket.retainageHeld += parseMoney(inv.retainageAmount);
    bucket.retainageReleased += parseMoney(inv.retainageReleased);
    bucket.retainageBalance = bucket.retainageHeld - bucket.retainageReleased;
    if (inv.changeOrderId && !byCoMap.has(inv.changeOrderId)) {
      byCoMap.set(inv.changeOrderId, bucket);
    }
  }
  return {
    base,
    byChangeOrder: Array.from(byCoMap.values()),
  };
}

/**
 * Roll-up of all invoices on a project (totalInvoiced, totalPaid, outstanding,
 * retainage held / released / balance). Used by the project detail page.
 */
export async function computeProjectInvoiceSummary(
  projectId: string,
): Promise<ProjectInvoiceSummary> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const invRows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.projectId, projectId));
    if (invRows.length === 0) {
      return {
        invoiceCount: 0,
        totalInvoiced: 0,
        totalInvoicedNet: 0,
        totalInvoicedVat: 0,
        totalPaid: 0,
        totalPaidNet: 0,
        totalPaidVat: 0,
        outstandingBalance: 0,
        outstandingBalanceNet: 0,
        outstandingBalanceVat: 0,
        retainageHeld: 0,
        retainageReleased: 0,
        retainageBalance: 0,
      };
    }
    // Pull payments for these invoices in one round-trip and compute
    // balances from payment rows so the project summary, the AR view, and
    // the dashboard all agree even if `inv.amount_paid` lags briefly.
    const invoiceIds = invRows.map((r) => r.id);
    const paymentRows = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceIds[0]));
    // Drizzle's `inArray` is the right tool for the multi-id case but
    // requires another import — fetch sequentially when there are <=20
    // invoices on a project (typical), one query when there is exactly 1.
    let allPayments = invoiceIds.length <= 1 ? paymentRows : [];
    if (invoiceIds.length > 1) {
      const { inArray } = await import('drizzle-orm');
      allPayments = await db
        .select()
        .from(invoicePayments)
        .where(inArray(invoicePayments.invoiceId, invoiceIds));
    }
    const paymentsByInvoice = groupPaymentsByInvoice(allPayments);
    let totalInvoiced = 0;
    let totalInvoicedNet = 0;
    let totalInvoicedVat = 0;
    let totalPaid = 0;
    let totalPaidNet = 0;
    let totalPaidVat = 0;
    let outstandingBalance = 0;
    let outstandingBalanceNet = 0;
    let outstandingBalanceVat = 0;
    let retainageHeld = 0;
    let retainageReleased = 0;
    for (const inv of invRows) {
      if (inv.status === 'void') continue;
      const split = computeInvoiceVatSplit(
        inv,
        paymentsByInvoice.get(inv.id) ?? [],
      );
      totalInvoiced += split.gross;
      totalInvoicedNet += split.net;
      totalInvoicedVat += split.vat;
      totalPaid += split.paidGross;
      totalPaidNet += split.paidNet;
      totalPaidVat += split.paidVat;
      outstandingBalance += split.balanceGross;
      outstandingBalanceNet += split.balanceNet;
      outstandingBalanceVat += split.balanceVat;
      retainageHeld += parseMoney(inv.retainageAmount);
      retainageReleased += parseMoney(inv.retainageReleased);
    }
    return {
      invoiceCount: invRows.filter((i) => i.status !== 'void').length,
      totalInvoiced,
      totalInvoicedNet,
      totalInvoicedVat,
      totalPaid,
      totalPaidNet,
      totalPaidVat,
      outstandingBalance,
      outstandingBalanceNet,
      outstandingBalanceVat,
      retainageHeld,
      retainageReleased,
      retainageBalance: retainageHeld - retainageReleased,
    };
  }
  return mockComputeSummary(projectId);
}
