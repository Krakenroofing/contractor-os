// Data layer for transaction_matches.
//
// Write paths go through actions that wrap match/unmatch in a transaction
// alongside the imported_transactions.reconciled_at flip. The functions
// here are the primitive building blocks.

import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  importedTransactions,
  transactionMatches,
  type NewTransactionMatch,
  type TransactionMatch,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

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
