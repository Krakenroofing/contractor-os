// Async data accessor for invoice payments.
//
// Each payment row is a "payment application" — it links a payment to one
// invoice, with an amount that may be a partial. Multiple payment rows can
// reference the same invoice (partial payments, deposit + balance, etc.).
//
// On every create or status flip, `recomputeInvoicePaymentState` re-derives
// the parent invoice's amountPaid and status by summing the current set of
// payment rows whose status is `received` or `applied`. Same logic, two
// backends:
//   - DB mode: SUM(...) over the invoicePayments table → UPDATE invoices
//   - Demo mode: existing in-memory mutation in mock-store

import 'server-only';
import { and, eq } from 'drizzle-orm';
import {
  invoicePayments,
  invoices,
  type InvoicePayment,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockPayments as mockList,
  getMockPayment as mockGet,
  getMockInvoicePayments as mockGetForInvoice,
  listInvoicePaymentsForCompany as mockListForCompany,
  createMockPayment as mockCreate,
  recomputeInvoicePaymentStateInMemory,
  DuplicatePaymentNumberError,
  type CreatePaymentInput,
} from '@/lib/mock-store';

export { DuplicatePaymentNumberError };
export type { CreatePaymentInput };

export async function listPayments(companyId: string): Promise<InvoicePayment[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select({ p: invoicePayments })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
      .where(eq(invoices.companyId, companyId));
    return rows
      .map((r) => r.p)
      .sort((a, b) => b.paidDate.localeCompare(a.paidDate));
  }
  return mockList(companyId);
}

export async function getPayment(
  companyId: string,
  id: string,
): Promise<InvoicePayment | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select({ p: invoicePayments })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
      .where(and(eq(invoicePayments.id, id), eq(invoices.companyId, companyId)))
      .limit(1);
    return rows[0]?.p;
  }
  return mockGet(companyId, id);
}

export async function getInvoicePayments(
  invoiceId: string,
): Promise<InvoicePayment[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId));
    return rows.sort((a, b) => a.paidDate.localeCompare(b.paidDate));
  }
  return mockGetForInvoice(invoiceId);
}

export async function listInvoicePaymentsForCompany(
  companyId: string,
): Promise<InvoicePayment[]> {
  if (isDatabaseConfigured()) {
    // Same shape as listPayments but ordering preserved (no sort) — used by
    // cash-collected calc and aging derivations.
    const db = getDb()!;
    const rows = await db
      .select({ p: invoicePayments })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
      .where(eq(invoices.companyId, companyId));
    return rows.map((r) => r.p);
  }
  return mockListForCompany(companyId);
}

/**
 * Recompute an invoice's `amountPaid` and `status` by summing all of its
 * payments where status ∈ {received, applied}. Mirrors the in-memory logic.
 */
export async function recomputeInvoicePaymentState(invoiceId: string): Promise<void> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const invRows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    const inv = invRows[0];
    if (!inv) return;
    const allPayments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId));
    const total = Number(inv.total);
    let paid = 0;
    for (const p of allPayments) {
      if (p.status === 'received' || p.status === 'applied') {
        paid += Number(p.amount);
      }
    }
    const now = new Date();
    const patch: Record<string, unknown> = {
      amountPaid: paid.toFixed(2),
      updatedAt: now,
    };
    if (paid >= total - 0.005) {
      patch.status = 'paid';
      patch.paidAt = now;
    } else if (paid > 0) {
      patch.status = 'partial';
      patch.paidAt = null;
    } else if (inv.status === 'paid' || inv.status === 'partial') {
      patch.status = 'sent';
      patch.paidAt = null;
    }
    await db.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
    return;
  }
  recomputeInvoicePaymentStateInMemory(invoiceId);
}

export async function createPayment(
  companyId: string,
  input: CreatePaymentInput,
): Promise<InvoicePayment> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Verify invoice belongs to the active company.
    const inv = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);
    if (inv.length === 0) {
      throw new Error('Invoice not found in active company');
    }
    if (input.paymentNumber !== '') {
      const dup = await db
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .where(eq(invoicePayments.paymentNumber, input.paymentNumber))
        .limit(1);
      if (dup.length > 0) throw new DuplicatePaymentNumberError();
    }
    const inserted = await db
      .insert(invoicePayments)
      .values({
        invoiceId: input.invoiceId,
        paymentNumber: input.paymentNumber,
        paidDate: input.paidDate,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        bankAccount: input.bankAccount,
        status: input.status,
        notes: input.notes,
      })
      .returning();
    await recomputeInvoicePaymentState(input.invoiceId);
    return inserted[0];
  }
  return mockCreate(companyId, input);
}
