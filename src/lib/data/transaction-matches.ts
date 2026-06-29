// Data layer for transaction_matches.
//
// Write paths go through actions that wrap match/unmatch in a transaction
// alongside the imported_transactions.reconciled_at flip. The functions
// here are the primitive building blocks.

import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  importedTransactions,
  importedTransactionLines,
  transactionMatches,
  payrollBills,
  invoicePayments,
  invoices,
  type NewTransactionMatch,
  type TransactionMatch,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

// A drizzle transaction handle. Inferred from db.transaction's callback so we
// don't depend on a named export that may differ across drizzle versions.
type Tx = Parameters<
  Parameters<NonNullable<ReturnType<typeof getDb>>['transaction']>[0]
>[0];

/**
 * Re-derive an invoice's amount_paid + status by summing its received/applied
 * payments — the tx-aware twin of recomputeInvoicePaymentState (which opens
 * its own connection and so can't run inside an open transaction).
 */
async function recomputeInvoiceStateInTx(
  tx: Tx,
  invoiceId: string,
): Promise<void> {
  const invRows = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  const inv = invRows[0];
  if (!inv) return;
  const pays = await tx
    .select()
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId));
  const total = Number(inv.total);
  let paid = 0;
  for (const p of pays) {
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
  await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
}

export class TransactionMatchesNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Reconciliation matching requires a configured database. Apply the reconciliation-matching-phase1 migration first.',
    );
    this.name = 'TransactionMatchesNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new TransactionMatchesNotAvailableInDemoError();
  }
  return getDb()!;
}

/** All ACTIVE (non-reversed) matches for a company. Cheap enough to load on
 *  the account page so per-row badges can resolve without N joins. */
export async function listActiveMatchesForCompany(
  companyId: string,
): Promise<TransactionMatch[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(transactionMatches)
    .where(
      and(
        eq(transactionMatches.companyId, companyId),
        isNull(transactionMatches.reversedAt),
      ),
    )
    .orderBy(desc(transactionMatches.matchedAt));
}

export async function getActiveMatchForTxn(
  companyId: string,
  importedTransactionId: string,
): Promise<TransactionMatch | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(transactionMatches)
    .where(
      and(
        eq(transactionMatches.companyId, companyId),
        eq(transactionMatches.importedTransactionId, importedTransactionId),
        isNull(transactionMatches.reversedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/** ALL active matches for one bank txn. A deposit can carry several
 *  invoice_payment matches (a lump customer payment), so this returns a list. */
export async function listActiveMatchesForTxn(
  companyId: string,
  importedTransactionId: string,
): Promise<TransactionMatch[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(transactionMatches)
    .where(
      and(
        eq(transactionMatches.companyId, companyId),
        eq(transactionMatches.importedTransactionId, importedTransactionId),
        isNull(transactionMatches.reversedAt),
      ),
    )
    .orderBy(desc(transactionMatches.matchedAt));
}

/**
 * Atomic: link a bank deposit to one OR MORE invoice payments (a lump customer
 * payment covering several invoices), and flip reconciled_at only when the
 * caller says the deposit is fully allocated. Partial allocations leave the
 * txn un-reconciled so the operator can come back and add more invoices.
 * Throws on the per-payment unique violation (a payment already matched
 * elsewhere) — the whole batch rolls back.
 */
export async function createInvoicePaymentMatchesAtomic(input: {
  companyId: string;
  importedTransactionId: string;
  invoicePaymentIds: string[];
  confidence: TransactionMatch['confidence'];
  matchedByUserId: string | null;
  reconcile: boolean;
}): Promise<TransactionMatch[]> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const rows: TransactionMatch[] = [];
    for (const paymentId of input.invoicePaymentIds) {
      const [row] = await tx
        .insert(transactionMatches)
        .values({
          companyId: input.companyId,
          importedTransactionId: input.importedTransactionId,
          matchType: 'invoice_payment',
          invoicePaymentId: paymentId,
          confidence: input.confidence,
          matchedByUserId: input.matchedByUserId,
        })
        .returning();
      rows.push(row);
    }
    if (input.reconcile) {
      await tx
        .update(importedTransactions)
        .set({ reconciledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(importedTransactions.id, input.importedTransactionId),
            eq(importedTransactions.companyId, input.companyId),
          ),
        );
    }
    return rows;
  });
}

/**
 * Match a deposit against one or more invoice BALANCES. For each allocation we
 * record a (possibly partial) invoice payment sized to the amount applied,
 * tagged with imported_transaction_id so Unmatch can remove exactly these
 * rows, then link it to the deposit via an invoice_payment match. The invoice
 * amount_paid/status is recomputed in-transaction so a partially-paid invoice
 * keeps an open balance for the next deposit.
 *
 * Atomic: payments + matches + per-invoice recompute + the reconciled_at flip
 * all commit together. Returns the created match rows.
 */
export async function createInvoiceBalancePaymentsAtomic(input: {
  companyId: string;
  importedTransactionId: string;
  /** One per ticked invoice, in allocation order. amount is the applied (≤
   *  invoice balance, ≤ deposit remaining) figure. */
  allocations: { invoiceId: string; amount: number }[];
  paidDate: string;
  bankAccountLabel?: string | null;
  confidence: TransactionMatch['confidence'];
  matchedByUserId: string | null;
  reconcile: boolean;
}): Promise<TransactionMatch[]> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const rows: TransactionMatch[] = [];
    const touchedInvoices = new Set<string>();
    for (const a of input.allocations) {
      if (a.amount <= 0.005) continue;
      const [payment] = await tx
        .insert(invoicePayments)
        .values({
          invoiceId: a.invoiceId,
          paymentNumber: '',
          paidDate: input.paidDate,
          amount: a.amount.toFixed(2),
          method: 'bank_match',
          bankAccount: input.bankAccountLabel ?? null,
          status: 'received',
          notes: 'Recorded from bank deposit reconciliation',
          importedTransactionId: input.importedTransactionId,
        })
        .returning();
      const [match] = await tx
        .insert(transactionMatches)
        .values({
          companyId: input.companyId,
          importedTransactionId: input.importedTransactionId,
          matchType: 'invoice_payment',
          invoicePaymentId: payment.id,
          confidence: input.confidence,
          matchedByUserId: input.matchedByUserId,
        })
        .returning();
      rows.push(match);
      touchedInvoices.add(a.invoiceId);
    }
    for (const invoiceId of touchedInvoices) {
      await recomputeInvoiceStateInTx(tx, invoiceId);
    }
    if (input.reconcile) {
      await tx
        .update(importedTransactions)
        .set({ reconciledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(importedTransactions.id, input.importedTransactionId),
            eq(importedTransactions.companyId, input.companyId),
          ),
        );
    }
    return rows;
  });
}

/**
 * Batch bill payment: match ONE money-out bank txn to MANY posted receipts
 * (bills), optionally recording the difference as a bank-fee expense split
 * line on the txn. Reconciles only when fully allocated (bills + fee ≈ the
 * withdrawal). Incremental: re-writes the single fee line each call. Each
 * receipt is still matched at most once (DB unique index).
 */
export async function createReceiptMatchesAtomic(input: {
  companyId: string;
  importedTransactionId: string;
  receiptIds: string[];
  /** Payroll bills (net-pay payable) settled by this same payment. */
  payrollBillIds?: string[];
  fee?: { accountingAccountId: string; amount: number; description?: string } | null;
  confidence: TransactionMatch['confidence'];
  matchedByUserId: string | null;
  reconcile: boolean;
}): Promise<TransactionMatch[]> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const rows: TransactionMatch[] = [];
    for (const receiptId of input.receiptIds) {
      const [row] = await tx
        .insert(transactionMatches)
        .values({
          companyId: input.companyId,
          importedTransactionId: input.importedTransactionId,
          matchType: 'receipt',
          receiptId,
          confidence: input.confidence,
          matchedByUserId: input.matchedByUserId,
        })
        .returning();
      rows.push(row);
    }
    for (const payrollBillId of input.payrollBillIds ?? []) {
      const [row] = await tx
        .insert(transactionMatches)
        .values({
          companyId: input.companyId,
          importedTransactionId: input.importedTransactionId,
          matchType: 'payroll_bill',
          payrollBillId,
          confidence: input.confidence,
          matchedByUserId: input.matchedByUserId,
        })
        .returning();
      rows.push(row);
      await tx
        .update(payrollBills)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(
          and(
            eq(payrollBills.id, payrollBillId),
            eq(payrollBills.companyId, input.companyId),
          ),
        );
    }
    // The bank-fee remainder is stored as the txn's single split line. A bill
    // payment carries no other splits (the bills hold their own detail), so
    // replacing all lines is safe.
    await tx
      .delete(importedTransactionLines)
      .where(
        eq(
          importedTransactionLines.importedTransactionId,
          input.importedTransactionId,
        ),
      );
    if (input.fee && input.fee.amount > 0) {
      await tx.insert(importedTransactionLines).values({
        companyId: input.companyId,
        importedTransactionId: input.importedTransactionId,
        sortOrder: 0,
        accountingAccountId: input.fee.accountingAccountId,
        description: input.fee.description ?? 'Bank / transaction fee',
        amount: input.fee.amount.toFixed(2),
      });
    }
    if (input.reconcile) {
      await tx
        .update(importedTransactions)
        .set({ reconciledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(importedTransactions.id, input.importedTransactionId),
            eq(importedTransactions.companyId, input.companyId),
          ),
        );
    }
    return rows;
  });
}

/** Single-row create. Caller must wrap with the reconciled_at flip on the
 *  imported transaction inside a transaction — see createMatchInTx. */
export async function createMatchRow(
  input: NewTransactionMatch,
): Promise<TransactionMatch> {
  const db = requireDb();
  const [row] = await db.insert(transactionMatches).values(input).returning();
  return row;
}

/**
 * Atomic: create a match row AND set reconciled_at on the bank-side txn.
 * Throws on unique-constraint violation (already matched) — caller should
 * surface this as a normal "match no longer available" error.
 */
export async function createMatchAtomic(input: {
  companyId: string;
  importedTransactionId: string;
  matchType: TransactionMatch['matchType'];
  invoicePaymentId?: string | null;
  receiptId?: string | null;
  jobCostEntryId?: string | null;
  transferPairedTxnId?: string | null;
  confidence: TransactionMatch['confidence'];
  matchedByUserId: string | null;
  notes?: string | null;
}): Promise<TransactionMatch> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(transactionMatches)
      .values({
        companyId: input.companyId,
        importedTransactionId: input.importedTransactionId,
        matchType: input.matchType,
        invoicePaymentId: input.invoicePaymentId ?? null,
        receiptId: input.receiptId ?? null,
        jobCostEntryId: input.jobCostEntryId ?? null,
        transferPairedTxnId: input.transferPairedTxnId ?? null,
        confidence: input.confidence,
        matchedByUserId: input.matchedByUserId,
        notes: input.notes ?? null,
      })
      .returning();
    await tx
      .update(importedTransactions)
      .set({ reconciledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(importedTransactions.id, input.importedTransactionId),
          eq(importedTransactions.companyId, input.companyId),
        ),
      );
    return row;
  });
}

/**
 * Reverse a match: mark reversed_at on the match row AND clear reconciled_at
 * on the bank-side txn (and the transfer pair if present). Transactional.
 */
export async function reverseMatchAtomic(input: {
  companyId: string;
  matchId: string;
  reversedByUserId: string | null;
}): Promise<TransactionMatch | undefined> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(transactionMatches)
      .where(
        and(
          eq(transactionMatches.id, input.matchId),
          eq(transactionMatches.companyId, input.companyId),
          isNull(transactionMatches.reversedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return undefined;

    const now = new Date();
    const [updated] = await tx
      .update(transactionMatches)
      .set({
        reversedAt: now,
        reversedByUserId: input.reversedByUserId,
        updatedAt: now,
      })
      .where(eq(transactionMatches.id, existing.id))
      .returning();

    // A reversed invoice-payment match: if the payment was CREATED by this
    // deposit's reconciliation (imported_transaction_id == this txn), remove it
    // and re-open the invoice's balance. Manually-recorded payments (NULL
    // imported_transaction_id, or linked from a different txn) are left intact.
    if (existing.matchType === 'invoice_payment' && existing.invoicePaymentId) {
      const payRows = await tx
        .select()
        .from(invoicePayments)
        .where(eq(invoicePayments.id, existing.invoicePaymentId))
        .limit(1);
      const pay = payRows[0];
      if (pay && pay.importedTransactionId === existing.importedTransactionId) {
        await tx
          .delete(invoicePayments)
          .where(eq(invoicePayments.id, pay.id));
        await recomputeInvoiceStateInTx(tx, pay.invoiceId);
      }
    }

    // A reversed payroll-bill match makes the bill payable again.
    if (existing.payrollBillId) {
      await tx
        .update(payrollBills)
        .set({ status: 'open', updatedAt: now })
        .where(
          and(
            eq(payrollBills.id, existing.payrollBillId),
            eq(payrollBills.companyId, input.companyId),
          ),
        );
    }

    // Clear reconciled_at on the bank txn(s) involved. For transfers we have
    // two txns to unflag and (likely) a paired match row to reverse too.
    const txnIds = new Set<string>([existing.importedTransactionId]);
    if (existing.transferPairedTxnId) {
      txnIds.add(existing.transferPairedTxnId);
      // Reverse the paired match row as well so we don't leave a half-link.
      await tx
        .update(transactionMatches)
        .set({
          reversedAt: now,
          reversedByUserId: input.reversedByUserId,
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionMatches.companyId, input.companyId),
            eq(transactionMatches.matchType, 'transfer'),
            eq(transactionMatches.importedTransactionId, existing.transferPairedTxnId),
            isNull(transactionMatches.reversedAt),
          ),
        );
    }
    await tx
      .update(importedTransactions)
      .set({ reconciledAt: null, updatedAt: now })
      .where(
        and(
          eq(importedTransactions.companyId, input.companyId),
          inArray(importedTransactions.id, Array.from(txnIds)),
        ),
      );
    return updated;
  });
}

/**
 * Atomic transfer pairing: ONE call writes two match rows (one per side) and
 * flips reconciled_at on both bank txns. Either both succeed or both roll
 * back.
 */
export async function createTransferPairAtomic(input: {
  companyId: string;
  txnAId: string;
  txnBId: string;
  matchedByUserId: string | null;
  notes?: string | null;
}): Promise<{ a: TransactionMatch; b: TransactionMatch }> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const now = new Date();
    const [a] = await tx
      .insert(transactionMatches)
      .values({
        companyId: input.companyId,
        importedTransactionId: input.txnAId,
        matchType: 'transfer',
        transferPairedTxnId: input.txnBId,
        confidence: 'manual',
        matchedByUserId: input.matchedByUserId,
        notes: input.notes ?? null,
      })
      .returning();
    const [b] = await tx
      .insert(transactionMatches)
      .values({
        companyId: input.companyId,
        importedTransactionId: input.txnBId,
        matchType: 'transfer',
        transferPairedTxnId: input.txnAId,
        confidence: 'manual',
        matchedByUserId: input.matchedByUserId,
        notes: input.notes ?? null,
      })
      .returning();
    await tx
      .update(importedTransactions)
      .set({ reconciledAt: now, updatedAt: now })
      .where(
        and(
          eq(importedTransactions.companyId, input.companyId),
          inArray(importedTransactions.id, [input.txnAId, input.txnBId]),
        ),
      );
    return { a, b };
  });
}

/** Count active matches by type — used by the dashboard summary. */
export async function countActiveMatchesByType(
  companyId: string,
): Promise<Record<TransactionMatch['matchType'], number>> {
  const empty: Record<TransactionMatch['matchType'], number> = {
    invoice_payment: 0,
    receipt: 0,
    job_cost_entry: 0,
    transfer: 0,
    owner_contribution: 0,
    owner_draw: 0,
  };
  if (!isDatabaseConfigured()) return empty;
  const db = getDb()!;
  const rows = await db
    .select({
      matchType: transactionMatches.matchType,
      n: sql<number>`count(*)::int`,
    })
    .from(transactionMatches)
    .where(
      and(
        eq(transactionMatches.companyId, companyId),
        isNull(transactionMatches.reversedAt),
      ),
    )
    .groupBy(transactionMatches.matchType);
  const out = { ...empty };
  for (const r of rows) {
    if (r.matchType in out) {
      out[r.matchType as TransactionMatch['matchType']] = r.n;
    }
  }
  return out;
}
