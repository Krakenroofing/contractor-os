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
  creditMemos,
  creditMemoApplications,
  type CreditMemo,
  type CreditMemoApplication,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

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
 * Soft-void a credit memo that has zero applications. Rejects voids on
 * credits with any application history — operator must unwind those
 * first (Phase 1.5).
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
