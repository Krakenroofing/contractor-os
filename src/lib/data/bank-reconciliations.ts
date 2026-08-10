// Data layer for bank statement reconciliation (QB-style).
//
// A reconciliation belongs to one bank account and one statement period:
// beginning balance, statement ending balance + date. "Cleared" transactions
// carry the reconciliation's id in imported_transactions.bank_reconciliation_id.
// Completing requires beginning + cleared deposits − cleared payments to equal
// the ending balance (checked in the action, not here).

import 'server-only';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  bankReconciliations,
  importedTransactions,
  type BankReconciliation,
  type ImportedTransaction,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export async function listBankReconciliations(
  companyId: string,
  filter: { bankAccountId?: string } = {},
): Promise<BankReconciliation[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds = [eq(bankReconciliations.companyId, companyId)];
  if (filter.bankAccountId) {
    conds.push(eq(bankReconciliations.bankAccountId, filter.bankAccountId));
  }
  return db
    .select()
    .from(bankReconciliations)
    .where(and(...conds))
    .orderBy(desc(bankReconciliations.statementDate));
}

export async function getBankReconciliation(
  companyId: string,
  id: string,
): Promise<BankReconciliation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.companyId, companyId),
        eq(bankReconciliations.id, id),
      ),
    )
    .limit(1);
  return rows[0];
}

/** The one in-progress reconciliation for an account, if any. */
export async function getOpenBankReconciliation(
  companyId: string,
  bankAccountId: string,
): Promise<BankReconciliation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.companyId, companyId),
        eq(bankReconciliations.bankAccountId, bankAccountId),
        eq(bankReconciliations.status, 'in_progress'),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Latest COMPLETED reconciliation — its ending balance is the next period's
 *  beginning balance. */
export async function getLastCompletedBankReconciliation(
  companyId: string,
  bankAccountId: string,
): Promise<BankReconciliation | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.companyId, companyId),
        eq(bankReconciliations.bankAccountId, bankAccountId),
        eq(bankReconciliations.status, 'completed'),
      ),
    )
    .orderBy(desc(bankReconciliations.statementDate))
    .limit(1);
  return rows[0];
}

export type NewBankReconciliationInput = {
  companyId: string;
  bankAccountId: string;
  statementDate: string;
  beginningBalance: number;
  endingBalance: number;
  createdByUserId: string | null;
};

export async function insertBankReconciliation(
  input: NewBankReconciliationInput,
): Promise<BankReconciliation> {
  if (!isDatabaseConfigured()) {
    throw new Error('Bank reconciliation requires a configured database.');
  }
  const db = getDb()!;
  const [row] = await db
    .insert(bankReconciliations)
    .values({
      companyId: input.companyId,
      bankAccountId: input.bankAccountId,
      statementDate: input.statementDate,
      beginningBalance: input.beginningBalance.toFixed(2),
      endingBalance: input.endingBalance.toFixed(2),
      status: 'in_progress',
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return row;
}

export async function updateBankReconciliation(
  companyId: string,
  id: string,
  patch: Partial<{
    statementDate: string;
    beginningBalance: number;
    endingBalance: number;
    status: string;
    completedAt: Date | null;
  }>,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .update(bankReconciliations)
    .set({
      ...(patch.statementDate !== undefined
        ? { statementDate: patch.statementDate }
        : {}),
      ...(patch.beginningBalance !== undefined
        ? { beginningBalance: patch.beginningBalance.toFixed(2) }
        : {}),
      ...(patch.endingBalance !== undefined
        ? { endingBalance: patch.endingBalance.toFixed(2) }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.completedAt !== undefined
        ? { completedAt: patch.completedAt }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bankReconciliations.companyId, companyId),
        eq(bankReconciliations.id, id),
      ),
    );
}

/** Deleting an in-progress reconciliation releases its cleared transactions
 *  (FK is ON DELETE SET NULL). */
export async function deleteBankReconciliation(
  companyId: string,
  id: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .delete(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.companyId, companyId),
        eq(bankReconciliations.id, id),
      ),
    );
}

/**
 * Transactions this reconciliation can clear: same bank account, not ignored,
 * dated on/before the statement date, and either uncleared or cleared by THIS
 * reconciliation. Earlier-period stragglers (uncleared rows older than the
 * previous statement) intentionally show up — same as QB.
 */
export async function listReconciliationCandidates(
  companyId: string,
  bankAccountId: string,
  reconciliationId: string,
  statementDate: string,
): Promise<ImportedTransaction[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select()
    .from(importedTransactions)
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        eq(importedTransactions.bankAccountId, bankAccountId),
        eq(importedTransactions.isIgnored, false),
        lte(importedTransactions.transactionDate, statementDate),
        or(
          isNull(importedTransactions.bankReconciliationId),
          eq(importedTransactions.bankReconciliationId, reconciliationId),
        ),
      ),
    )
    .orderBy(importedTransactions.transactionDate);
}

/** Assign (cleared=true) or release (cleared=false) one transaction. Only
 *  touches rows that are uncleared or belong to this reconciliation — never
 *  steals a row cleared by a completed reconciliation. */
export async function setTransactionCleared(
  companyId: string,
  reconciliationId: string,
  transactionId: string,
  cleared: boolean,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .update(importedTransactions)
    .set({
      bankReconciliationId: cleared ? reconciliationId : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        eq(importedTransactions.id, transactionId),
        or(
          isNull(importedTransactions.bankReconciliationId),
          eq(importedTransactions.bankReconciliationId, reconciliationId),
        ),
      ),
    );
}

/** Bulk assign/release. Same ownership guard as setTransactionCleared. */
export async function setTransactionsCleared(
  companyId: string,
  reconciliationId: string,
  transactionIds: string[],
  cleared: boolean,
): Promise<void> {
  if (!isDatabaseConfigured() || transactionIds.length === 0) return;
  const db = getDb()!;
  await db
    .update(importedTransactions)
    .set({
      bankReconciliationId: cleared ? reconciliationId : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        inArray(importedTransactions.id, transactionIds),
        or(
          isNull(importedTransactions.bankReconciliationId),
          eq(importedTransactions.bankReconciliationId, reconciliationId),
        ),
      ),
    );
}

export type NewManualBankTransactionInput = {
  companyId: string;
  batchId: string;
  bankAccountId: string;
  transactionDate: string;
  description: string;
  /** Signed: positive = deposit, negative = payment. */
  amount: number;
  dedupeHash: string;
  bankReconciliationId: string | null;
};

/** A hand-entered bank line for something the statement import missed. Flows
 *  into the normal categorization queue like any imported row. */
export async function insertManualBankTransaction(
  input: NewManualBankTransactionInput,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error('Manual bank entries require a configured database.');
  }
  const db = getDb()!;
  await db.insert(importedTransactions).values({
    companyId: input.companyId,
    batchId: input.batchId,
    bankAccountId: input.bankAccountId,
    transactionDate: input.transactionDate,
    description: input.description,
    debit: input.amount < 0 ? Math.abs(input.amount).toFixed(2) : null,
    credit: input.amount > 0 ? input.amount.toFixed(2) : null,
    amount: input.amount.toFixed(2),
    sourceFilename: 'Manual entry',
    dedupeHash: input.dedupeHash,
    rawRow: { manual: true },
    bankReconciliationId: input.bankReconciliationId,
  });
}

/** Correct a hand-entered bank line (date / description / signed amount).
 *  Only rows created via insertManualBankTransaction qualify — imported
 *  statement rows mirror the bank and must never be edited. */
export async function updateManualBankTransaction(
  companyId: string,
  id: string,
  patch: { transactionDate: string; description: string; amount: number },
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const db = getDb()!;
  const rows = await db
    .update(importedTransactions)
    .set({
      transactionDate: patch.transactionDate,
      description: patch.description,
      debit: patch.amount < 0 ? Math.abs(patch.amount).toFixed(2) : null,
      credit: patch.amount > 0 ? patch.amount.toFixed(2) : null,
      amount: patch.amount.toFixed(2),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        eq(importedTransactions.id, id),
        eq(importedTransactions.sourceFilename, 'Manual entry'),
      ),
    )
    .returning({ id: importedTransactions.id });
  return rows.length > 0;
}

/** Remove a hand-entered bank line (e.g. it duplicated an imported row).
 *  Split lines cascade via FK; the caller clears any GL entry. */
export async function deleteManualBankTransaction(
  companyId: string,
  id: string,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const db = getDb()!;
  const rows = await db
    .delete(importedTransactions)
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        eq(importedTransactions.id, id),
        eq(importedTransactions.sourceFilename, 'Manual entry'),
      ),
    )
    .returning({ id: importedTransactions.id });
  return rows.length > 0;
}

/** Cleared deposits/payments totals for a reconciliation — the server-side
 *  version of the workspace math, used by the finish action so the $0.00
 *  difference check can't be spoofed by a stale client. */
export async function sumClearedForReconciliation(
  companyId: string,
  reconciliationId: string,
): Promise<{ deposits: number; payments: number; count: number }> {
  if (!isDatabaseConfigured()) return { deposits: 0, payments: 0, count: 0 };
  const db = getDb()!;
  const rows = await db
    .select({
      deposits: sql<string>`COALESCE(SUM(CASE WHEN ${importedTransactions.amount} > 0 THEN ${importedTransactions.amount} ELSE 0 END), 0)`,
      payments: sql<string>`COALESCE(SUM(CASE WHEN ${importedTransactions.amount} < 0 THEN -${importedTransactions.amount} ELSE 0 END), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(importedTransactions)
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        eq(importedTransactions.bankReconciliationId, reconciliationId),
      ),
    );
  return {
    deposits: Number(rows[0]?.deposits ?? 0),
    payments: Number(rows[0]?.payments ?? 0),
    count: Number(rows[0]?.count ?? 0),
  };
}
