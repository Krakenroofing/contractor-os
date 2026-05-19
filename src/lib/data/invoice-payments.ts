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
import { and, eq, ne } from 'drizzle-orm';
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
  deleteOrphanedPaymentsForVoidedInvoice as mockDeleteOrphanedPayments,
  recomputeInvoicePaymentStateInMemory,
  DuplicatePaymentNumberError,
  type CreatePaymentInput,
} from '@/lib/mock-store';

export { DuplicatePaymentNumberError };
export type { CreatePaymentInput };

// Voided invoices vanish from every total in this system — that's the
// operator's mental model ("the payment never hit the bank"). Banking
// reconciliation is a separate surface; the cash from a voided invoice's
// payment is something the operator handles manually (refund the customer
// or re-apply the cash to a different invoice). The filter below stops
// orphaned payments from polluting AR, the payment summary report, and
// every other aggregation that scans the payments table.
export async function listPayments(companyId: string): Promise<InvoicePayment[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select({ p: invoicePayments })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          ne(invoices.status, 'void'),
        ),
      );
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
    // cash-collected calc and aging derivations. Same void-filter rationale
    // as listPayments: a voided invoice's payments vanish from every total.
    const db = getDb()!;
    const rows = await db
      .select({ p: invoicePayments })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          ne(invoices.status, 'void'),
        ),
      );
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
      // Scope the duplicate check to this company by joining through invoices.
      // Previously this was a global check, which blocked tenants from each
      // other's payment-number sequences (PAY-2026-001 conflict, etc.).
      const dup = await db
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
        .where(
          and(
            eq(invoicePayments.paymentNumber, input.paymentNumber),
            eq(invoices.companyId, companyId),
          ),
        )
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

/**
 * Hard-delete every payment row attached to a voided invoice. Used by the
 * voided-invoices-with-orphaned-payments cleanup flow when the operator has
 * confirmed the payment was a duplicate (cash already re-recorded against a
 * corrected invoice).
 *
 * Hard-gated: throws if the invoice is not actually voided, so the operator
 * can't accidentally wipe payments off a live invoice through this path.
 * Returns the number of rows deleted and the combined amount for activity
 * logging.
 */
export class InvoiceNotVoidedError extends Error {
  constructor() {
    super('Refusing to delete payments: invoice is not voided.');
    this.name = 'InvoiceNotVoidedError';
  }
}

export async function deleteOrphanedPaymentsForVoidedInvoice(
  companyId: string,
  invoiceId: string,
): Promise<{ deletedCount: number; deletedAmount: number }> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Verify invoice exists in the active company AND is voided.
    const invRows = await db
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);
    const inv = invRows[0];
    if (!inv) {
      throw new Error('Invoice not found in active company');
    }
    if (inv.status !== 'void') {
      throw new InvoiceNotVoidedError();
    }
    // Snapshot for the return value, then delete.
    const toDelete = await db
      .select({ amount: invoicePayments.amount })
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId));
    if (toDelete.length === 0) {
      return { deletedCount: 0, deletedAmount: 0 };
    }
    const deletedAmount = toDelete.reduce((s, r) => s + Number(r.amount), 0);
    await db
      .delete(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId));
    // Recompute so amountPaid reflects the now-empty payment set. The void
    // status stays put (recompute only flips paid → sent when there were
    // payments; for void invoices the else-if doesn't match).
    await recomputeInvoicePaymentState(invoiceId);
    return { deletedCount: toDelete.length, deletedAmount };
  }
  // Demo mode: mock-store path.
  return mockDeleteOrphanedPayments(companyId, invoiceId);
}
