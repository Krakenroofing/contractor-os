// Async data accessor for invoices (header + line items + project summary).
//
// Status timestamps (sentAt / paidAt) and the cumulative payment-state
// recompute live in @/lib/mock-store / @/lib/data/invoice-payments — this
// module is just CRUD.

import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  invoiceLineItems,
  invoices,
  type Invoice,
  type InvoiceLineItem,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockInvoices as mockList,
  getMockInvoice as mockGet,
  getMockInvoiceLineItems as mockGetLines,
  listInvoicesForProject as mockListForProject,
  createMockInvoice as mockCreate,
  updateMockInvoiceHeader as mockUpdateHeader,
  computeProjectInvoiceSummary as mockComputeSummary,
  DuplicateInvoiceNumberError,
  type CreateInvoiceInput,
  type ProjectInvoiceSummary,
} from '@/lib/mock-store';

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
 * Roll-up of all invoices on a project (totalInvoiced, totalPaid, outstanding,
 * retainage held / released / balance). Used by the project detail page.
 */
export async function computeProjectInvoiceSummary(
  projectId: string,
): Promise<ProjectInvoiceSummary> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.projectId, projectId));
    let totalInvoiced = 0;
    let totalPaid = 0;
    let retainageHeld = 0;
    let retainageReleased = 0;
    for (const inv of rows) {
      if (inv.status === 'void') continue;
      totalInvoiced += Number(inv.total);
      totalPaid += Number(inv.amountPaid);
      retainageHeld += Number(inv.retainageAmount);
      retainageReleased += Number(inv.retainageReleased);
    }
    return {
      invoiceCount: rows.length,
      totalInvoiced,
      totalPaid,
      outstandingBalance: totalInvoiced - totalPaid,
      retainageHeld,
      retainageReleased,
      retainageBalance: retainageHeld - retainageReleased,
    };
  }
  return mockComputeSummary(projectId);
}
