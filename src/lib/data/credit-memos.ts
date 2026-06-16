// Data layer for credit memos + their applications.
//
// Workflow:
//   1. createCreditMemo  — operator issues a credit. Status='issued'.
//   2. applyCreditMemoToInvoice — net it against an invoice. Inserts an
//      application row, bumps applied_amount, recomputes status.
//   3. refundCreditMemo — cash out the door. Same shape as (2) but
//      kind='cash_refund', no invoice link.
//   4. voidCreditMemo — soft-void (status=void, voided_at=now). Cannot
//      be voided once any application exists; operator must unapply
//      first (Phase 1.5 — not implemented yet).
//
// Transactions everywhere a write affects multiple rows: each
// application + status update must land atomically so the running
// applied_amount can never diverge from the sum of applications.

import 'server-only';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  companies,
  creditMemos,
  creditMemoApplications,
  invoicePayments,
  invoices,
  type CreditMemo,
  type CreditMemoApplication,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

// Method marker on the contra invoice_payment a credit application writes.
const CREDIT_MEMO_PAYMENT_METHOD = 'credit_memo';

// Recompute an invoice's amount_paid + status from its payment rows, inside
// an open transaction (mirrors recomputeInvoicePaymentState, which can't be
// reused here because it opens its own connection and wouldn't see the tx's
// uncommitted rows). Credit applications settle the receivable via a contra
// payment row, so this is what reduces the invoice balance and AR.
async function recomputeInvoiceInTx(
  tx: Parameters<
    Parameters<NonNullable<ReturnType<typeof getDb>>['transaction']>[0]
  >[0],
  invoiceId: string,
): Promise<void> {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) return;
  const pays = await tx
    .select({ amount: invoicePayments.amount, status: invoicePayments.status })
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId));
  let paid = 0;
  for (const p of pays) {
    if (p.status === 'received' || p.status === 'applied') paid += Number(p.amount);
  }
  const total = Number(inv.total);
  const patch: Record<string, unknown> = {
    amountPaid: paid.toFixed(2),
    updatedAt: new Date(),
  };
  if (paid >= total - 0.005) {
    patch.status = 'paid';
    patch.paidAt = new Date();
  } else if (paid > 0) {
    patch.status = 'partial';
    patch.paidAt = null;
  } else if (inv.status === 'paid' || inv.status === 'partial') {
    patch.status = 'sent';
    patch.paidAt = null;
  }
  await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
}

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'credit_memos requires a configured database — demo mode is not supported.',
    );
  }
  return getDb()!;
}

export type CreateCreditMemoInput = {
  customerId: string;
  projectId: string | null;
  invoiceId: string | null;
  issueDate: string;
  amount: number;
  reason: string;
  notes: string | null;
  createdByUserId: string | null;
  // Set when this credit is a refund for a canceled/reduced scope that's
  // also being booked as a deduct change order. Links the two so reporting
  // nets the refund out of billed-net. null for goodwill / open credits.
  changeOrderId?: string | null;
};

/**
 * Generate the next "CM-YYYY-NNN" number for this company. Pre-pads to
 * 3 digits. Mirrors the PO numbering scheme operator already uses.
 */
async function nextCreditMemoNumber(companyId: string): Promise<string> {
  if (!isDatabaseConfigured()) return 'CM-DEMO-001';
  const db = getDb()!;
  const year = new Date().getFullYear();
  const prefix = `CM-${year}-`;
  const rows = await db
    .select({ number: creditMemos.number })
    .from(creditMemos)
    .where(eq(creditMemos.companyId, companyId));
  const matching = rows
    .map((r) => r.number)
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function createCreditMemo(
  companyId: string,
  input: CreateCreditMemoInput,
): Promise<CreditMemo> {
  const db = requireDb();
  if (!(input.amount > 0)) {
    throw new Error('Credit memo amount must be positive.');
  }
  const number = await nextCreditMemoNumber(companyId);
  const [row] = await db
    .insert(creditMemos)
    .values({
      companyId,
      customerId: input.customerId,
      projectId: input.projectId,
      invoiceId: input.invoiceId,
      changeOrderId: input.changeOrderId ?? null,
      number,
      issueDate: input.issueDate,
      amount: input.amount.toFixed(2),
      appliedAmount: '0',
      status: 'issued',
      reason: input.reason,
      notes: input.notes,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return row;
}

export async function getCreditMemo(
  companyId: string,
  id: string,
): Promise<CreditMemo | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(creditMemos)
    .where(
      and(eq(creditMemos.id, id), eq(creditMemos.companyId, companyId)),
    )
    .limit(1);
  return rows[0];
}

export async function listCreditMemosForCustomer(
  companyId: string,
  customerId: string,
): Promise<CreditMemo[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(creditMemos)
    .where(
      and(
        eq(creditMemos.companyId, companyId),
        eq(creditMemos.customerId, customerId),
        ne(creditMemos.status, 'void'),
      ),
    )
    .orderBy(desc(creditMemos.issueDate), desc(creditMemos.createdAt));
}

export async function listCreditMemosForProject(
  companyId: string,
  projectId: string,
): Promise<CreditMemo[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(creditMemos)
    .where(
      and(
        eq(creditMemos.companyId, companyId),
        eq(creditMemos.projectId, projectId),
        ne(creditMemos.status, 'void'),
      ),
    )
    .orderBy(desc(creditMemos.issueDate));
}

export async function listCreditMemosForInvoice(
  companyId: string,
  invoiceId: string,
): Promise<CreditMemo[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(creditMemos)
    .where(
      and(
        eq(creditMemos.companyId, companyId),
        eq(creditMemos.invoiceId, invoiceId),
        ne(creditMemos.status, 'void'),
      ),
    )
    .orderBy(desc(creditMemos.issueDate));
}

/**
 * Sum of (amount − applied_amount) across all non-void credits for a
 * customer. This is what the customer can apply to future invoices, or
 * what we owe them as a refund. Returns 0 in demo mode.
 */
export async function computeCustomerOpenCredit(
  companyId: string,
  customerId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({
      open: sql<string>`COALESCE(SUM(${creditMemos.amount} - ${creditMemos.appliedAmount}), 0)`,
    })
    .from(creditMemos)
    .where(
      and(
        eq(creditMemos.companyId, companyId),
        eq(creditMemos.customerId, customerId),
        ne(creditMemos.status, 'void'),
      ),
    );
  return Number(rows[0]?.open ?? '0');
}

/**
 * Bulk open-credit map for the AR-aging report and the customer-summary
 * tile. One row per customer with any non-void credit.
 */
export async function getOpenCreditByCustomerMap(
  companyId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!isDatabaseConfigured()) return map;
  const db = getDb()!;
  const rows = await db
    .select({
      customerId: creditMemos.customerId,
      open: sql<string>`COALESCE(SUM(${creditMemos.amount} - ${creditMemos.appliedAmount}), 0)`,
    })
    .from(creditMemos)
    .where(
      and(
        eq(creditMemos.companyId, companyId),
        ne(creditMemos.status, 'void'),
      ),
    )
    .groupBy(creditMemos.customerId);
  for (const r of rows) {
    const v = Number(r.open);
    if (v > 0) map.set(r.customerId, v);
  }
  return map;
}

export async function listApplicationsForCreditMemo(
  companyId: string,
  creditMemoId: string,
): Promise<CreditMemoApplication[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(creditMemoApplications)
    .where(
      and(
        eq(creditMemoApplications.companyId, companyId),
        eq(creditMemoApplications.creditMemoId, creditMemoId),
      ),
    )
    .orderBy(asc(creditMemoApplications.appliedAt));
}

/**
 * Sum of invoice-application amounts that target a given invoice.
 * Subtracted from the invoice's net billed value in financial reports.
 */
export async function getInvoiceCreditApplicationsMap(
  companyId: string,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!isDatabaseConfigured() || invoiceIds.length === 0) return map;
  const db = getDb()!;
  const rows = await db
    .select({
      invoiceId: creditMemoApplications.invoiceId,
      total: sql<string>`COALESCE(SUM(${creditMemoApplications.amount}), 0)`,
    })
    .from(creditMemoApplications)
    .where(
      and(
        eq(creditMemoApplications.companyId, companyId),
        eq(creditMemoApplications.kind, 'invoice_application'),
        inArray(creditMemoApplications.invoiceId, invoiceIds),
      ),
    )
    .groupBy(creditMemoApplications.invoiceId);
  for (const r of rows) {
    if (r.invoiceId) map.set(r.invoiceId, Number(r.total));
  }
  return map;
}

/**
 * Per-project NET sum of credit memos linked to a deduct change order (refunds
 * for canceled/reduced scope). Reporting subtracts these from the project's
 * billed-NET so "still billable" stays coherent: the linked CO already lowered
 * the revised contract (NET) by the same amount, and the original invoice is
 * left intact at full value. Void credits are excluded.
 *
 * Refund credit memos are stored GROSS (base + VAT already collected was handed
 * back). The contract and billed figures are NET, so we de-VAT the credit using
 * the company's VAT rate before netting — comparing net-to-net. (A 0% / exempt
 * company has factor 1, so gross == net.)
 */
export async function getContractReductionRefundByProjectMap(
  companyId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!isDatabaseConfigured()) return map;
  const db = getDb()!;
  const rows = await db
    .select({
      projectId: creditMemos.projectId,
      total: sql<string>`COALESCE(SUM(${creditMemos.amount} / (1 + ${companies.vatRatePercent} / 100.0)), 0)`,
    })
    .from(creditMemos)
    .innerJoin(companies, eq(companies.id, creditMemos.companyId))
    .where(
      and(
        eq(creditMemos.companyId, companyId),
        ne(creditMemos.status, 'void'),
        sql`${creditMemos.changeOrderId} IS NOT NULL`,
        sql`${creditMemos.projectId} IS NOT NULL`,
      ),
    )
    .groupBy(creditMemos.projectId);
  for (const r of rows) {
    if (r.projectId) map.set(r.projectId, Math.round(Number(r.total) * 100) / 100);
  }
  return map;
}

export type ApplyCreditToInvoiceInput = {
  appliedAt: string;
  amount: number;
  invoiceId: string;
  notes: string | null;
  createdByUserId: string | null;
};

export async function applyCreditMemoToInvoice(
  companyId: string,
  creditMemoId: string,
  input: ApplyCreditToInvoiceInput,
): Promise<CreditMemoApplication> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const [cm] = await tx
      .select()
      .from(creditMemos)
      .where(
        and(
          eq(creditMemos.id, creditMemoId),
          eq(creditMemos.companyId, companyId),
        ),
      )
      .limit(1);
    if (!cm) throw new Error('Credit memo not found.');
    if (cm.status === 'void') throw new Error('Cannot apply a void credit.');
    const remaining = Number(cm.amount) - Number(cm.appliedAmount);
    if (input.amount > remaining + 0.005) {
      throw new Error(
        `Credit only has ${remaining.toFixed(2)} remaining — can't apply ${input.amount.toFixed(2)}.`,
      );
    }

    const [app] = await tx
      .insert(creditMemoApplications)
      .values({
        companyId,
        creditMemoId,
        appliedAt: input.appliedAt,
        amount: input.amount.toFixed(2),
        kind: 'invoice_application',
        invoiceId: input.invoiceId,
        notes: input.notes,
        createdByUserId: input.createdByUserId,
      })
      .returning();

    const newApplied = Number(cm.appliedAmount) + input.amount;
    const newStatus =
      newApplied + 0.005 >= Number(cm.amount)
        ? 'applied'
        : 'partially_applied';
    await tx
      .update(creditMemos)
      .set({
        appliedAmount: newApplied.toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(creditMemos.id, creditMemoId));

    // VAT-recompute settlement. A credit applied to an unpaid invoice is
    // VAT-exclusive: input.amount is NET. Crediting net work also removes the
    // VAT that would have been due on it (never collected), so the receivable
    // drops by net + its VAT. We settle the contra payment at
    // amount × (1 + invoice VAT rate). The credit memo itself is consumed in
    // NET terms (appliedAmount/application.amount above), so its face value and
    // open balance stay net — only the receivable settlement is grossed up.
    // A 0% / exempt invoice has factor 1 (flat settlement).
    const [invForVat] = await tx
      .select({ subtotal: invoices.subtotal, taxAmount: invoices.taxAmount })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    const invSubtotal = invForVat ? Number(invForVat.subtotal) : 0;
    const invTax = invForVat ? Number(invForVat.taxAmount) : 0;
    const vatFactor = invSubtotal > 0 ? 1 + invTax / invSubtotal : 1;
    const settlement = Math.round(input.amount * vatFactor * 100) / 100;

    // Settle the receivable: a credit application is a non-cash settlement
    // of the invoice. Write a contra payment row (method 'credit_memo') and
    // recompute the invoice — this is what actually reduces the invoice
    // balance, flips status, and drops it out of AR (all of which key off
    // payment rows). reference = the credit number so unapply can reverse it.
    await tx.insert(invoicePayments).values({
      invoiceId: input.invoiceId,
      paymentNumber: '',
      paidDate: input.appliedAt,
      amount: settlement.toFixed(2),
      method: CREDIT_MEMO_PAYMENT_METHOD,
      reference: cm.number,
      bankAccount: null,
      status: 'applied',
      notes: input.notes ?? `Credit memo ${cm.number}`,
    });
    await recomputeInvoiceInTx(tx, input.invoiceId);

    return app;
  });
}

export type RefundCreditMemoInput = {
  appliedAt: string;
  amount: number;
  bankAccount: string | null;
  reference: string | null;
  notes: string | null;
  createdByUserId: string | null;
};

export async function refundCreditMemo(
  companyId: string,
  creditMemoId: string,
  input: RefundCreditMemoInput,
): Promise<CreditMemoApplication> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const [cm] = await tx
      .select()
      .from(creditMemos)
      .where(
        and(
          eq(creditMemos.id, creditMemoId),
          eq(creditMemos.companyId, companyId),
        ),
      )
      .limit(1);
    if (!cm) throw new Error('Credit memo not found.');
    if (cm.status === 'void') throw new Error('Cannot refund a void credit.');
    const remaining = Number(cm.amount) - Number(cm.appliedAmount);
    if (input.amount > remaining + 0.005) {
      throw new Error(
        `Credit only has ${remaining.toFixed(2)} remaining — can't refund ${input.amount.toFixed(2)}.`,
      );
    }

    const [app] = await tx
      .insert(creditMemoApplications)
      .values({
        companyId,
        creditMemoId,
        appliedAt: input.appliedAt,
        amount: input.amount.toFixed(2),
        kind: 'cash_refund',
        invoiceId: null,
        bankAccount: input.bankAccount,
        reference: input.reference,
        notes: input.notes,
        createdByUserId: input.createdByUserId,
      })
      .returning();

    const newApplied = Number(cm.appliedAmount) + input.amount;
    // Status: 'refunded' only if every application so far is a cash
    // refund AND the credit is fully consumed. Otherwise:
    //   - fully consumed via mixed/invoice apps → 'applied'
    //   - partial → 'partially_applied'
    const allApplications = await tx
      .select({ kind: creditMemoApplications.kind })
      .from(creditMemoApplications)
      .where(eq(creditMemoApplications.creditMemoId, creditMemoId));
    const allRefund = allApplications.every((a) => a.kind === 'cash_refund');
    const fullyConsumed = newApplied + 0.005 >= Number(cm.amount);
    const newStatus = fullyConsumed
      ? allRefund
        ? 'refunded'
        : 'applied'
      : 'partially_applied';

    await tx
      .update(creditMemos)
      .set({
        appliedAmount: newApplied.toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(creditMemos.id, creditMemoId));

    return app;
  });
}

/**
 * Reverse a single credit-memo application. Used when an operator
 * accidentally applied a credit to the wrong invoice (or cut a refund
 * check that wasn't sent). In one transaction: delete the application
 * row, decrement applied_amount on the parent credit memo, recompute
 * status (back to issued if no apps remain, partially_applied otherwise).
 *
 * Works for both invoice_application and cash_refund kinds — caller
 * decides which is appropriate.
 */
export async function unapplyCreditMemoApplication(
  companyId: string,
  applicationId: string,
): Promise<{ creditMemoId: string }> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(creditMemoApplications)
      .where(
        and(
          eq(creditMemoApplications.id, applicationId),
          eq(creditMemoApplications.companyId, companyId),
        ),
      )
      .limit(1);
    if (!app) throw new Error('Application not found.');

    const [cm] = await tx
      .select()
      .from(creditMemos)
      .where(
        and(
          eq(creditMemos.id, app.creditMemoId),
          eq(creditMemos.companyId, companyId),
        ),
      )
      .limit(1);
    if (!cm) throw new Error('Parent credit memo not found.');

    await tx
      .delete(creditMemoApplications)
      .where(eq(creditMemoApplications.id, applicationId));

    const newApplied = Math.max(
      Number(cm.appliedAmount) - Number(app.amount),
      0,
    );
    // Status recomputation: if nothing applied → 'issued'; if some still
    // applied → 'partially_applied'. Never reverts to 'applied' / 'refunded'
    // since we just removed at least one row.
    const newStatus: 'issued' | 'partially_applied' =
      newApplied <= 0.005 ? 'issued' : 'partially_applied';
    await tx
      .update(creditMemos)
      .set({
        appliedAmount: newApplied.toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(creditMemos.id, cm.id));

    // Reverse the contra payment this application wrote against the invoice
    // (cash refunds never wrote one), then recompute so the invoice balance
    // and AR come back. Match on invoice + credit-memo method + number (NOT
    // amount — the contra is grossed up to net + VAT, so it no longer equals
    // the application's net amount), delete one.
    if (app.kind === 'invoice_application' && app.invoiceId) {
      const [contra] = await tx
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .where(
          and(
            eq(invoicePayments.invoiceId, app.invoiceId),
            eq(invoicePayments.method, CREDIT_MEMO_PAYMENT_METHOD),
            eq(invoicePayments.reference, cm.number),
          ),
        )
        .limit(1);
      if (contra) {
        await tx
          .delete(invoicePayments)
          .where(eq(invoicePayments.id, contra.id));
      }
      await recomputeInvoiceInTx(tx, app.invoiceId);
    }

    return { creditMemoId: cm.id };
  });
}

/**
 * Soft-void a credit memo that has zero applications. Rejects voids on
 * credits with any application history — operator must unwind those
 * first via unapplyCreditMemoApplication.
 */
export async function voidCreditMemo(
  companyId: string,
  id: string,
): Promise<void> {
  const db = requireDb();
  await db.transaction(async (tx) => {
    const apps = await tx
      .select({ id: creditMemoApplications.id })
      .from(creditMemoApplications)
      .where(eq(creditMemoApplications.creditMemoId, id))
      .limit(1);
    if (apps.length > 0) {
      throw new Error(
        'Credit has been applied or refunded — unwind those applications before voiding.',
      );
    }
    await tx
      .update(creditMemos)
      .set({
        status: 'void',
        voidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(creditMemos.id, id), eq(creditMemos.companyId, companyId)),
      );
  });
}

// Demo mode is intentionally unsupported here — credit memos always
// require the real DB. requireDb() throws otherwise.
void isNull;
