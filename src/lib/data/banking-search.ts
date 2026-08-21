// Cross-record banking search: bank transactions + receipts/bills in one
// query box. Text terms match descriptions / payees / memos / references /
// vendors; a numeric-looking query ALSO matches amounts — commas, "$", and
// spaces are stripped first, so "1,500", "$1500" and "1500.00" are the same
// search. A number without cents matches any amount in that dollar (1500
// finds 1,500.00 and 1,500.99); with cents it matches exactly.

import 'server-only';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  bankAccounts,
  importedTransactions,
  importedTransactionLines,
  receiptLines,
  receipts,
  vendors,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type BankingSearchTxn = {
  id: string;
  date: string;
  description: string;
  payee: string | null;
  reference: string | null;
  amount: number;
  bankAccountId: string;
  accountName: string;
  isIgnored: boolean;
};

export type BankingSearchReceipt = {
  id: string;
  date: string;
  vendorName: string | null;
  status: string;
  total: number;
  notes: string | null;
};

export type BankingSearchResult = {
  query: string;
  /** Parsed numeric value when the query looks like an amount, else null. */
  numeric: number | null;
  transactions: BankingSearchTxn[];
  receipts: BankingSearchReceipt[];
  /** True when a result list was cut at the limit. */
  truncated: boolean;
};

const LIMIT = 100;

/** "1,500", "$1,500.00", "bsd 1500" → 1500 / 1500.00. Null when the query
 *  isn't purely an amount. */
export function parseAmountQuery(raw: string): {
  value: number;
  hasCents: boolean;
} | null {
  const cleaned = raw
    .trim()
    .replace(/^(bsd|usd|\$)\s*/i, '')
    .replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return { value, hasCents: cleaned.includes('.') };
}

/** Amount predicate for a numeric column: exact (±½¢) when cents were
 *  typed, whole-dollar bucket otherwise. Matches on absolute value so a
 *  withdrawal of −1,500 is found by "1500". */
function amountMatch(column: SQL | { getSQL(): SQL }, q: { value: number; hasCents: boolean }): SQL {
  if (q.hasCents) {
    return sql`ABS(ABS(${column}) - ${q.value}) < 0.005`;
  }
  return sql`ABS(${column}) >= ${q.value} AND ABS(${column}) < ${q.value + 1}`;
}

export async function searchBanking(
  companyId: string,
  rawQuery: string,
): Promise<BankingSearchResult> {
  const query = rawQuery.trim();
  const numericQ = parseAmountQuery(query);
  const empty: BankingSearchResult = {
    query,
    numeric: numericQ?.value ?? null,
    transactions: [],
    receipts: [],
    truncated: false,
  };
  if (!isDatabaseConfigured() || query.length < 1) return empty;
  const db = getDb()!;
  const like = `%${query}%`;

  // ---- Bank transactions ----
  const txnTextConds: SQL[] = [
    ilike(importedTransactions.description, like),
    ilike(importedTransactions.payee, like),
    ilike(importedTransactions.memo, like),
    ilike(importedTransactions.reference, like),
  ];
  const txnConds: SQL[] = [...txnTextConds];
  if (numericQ) {
    txnConds.push(amountMatch(importedTransactions.amount, numericQ));
    // Split-line amounts too — an itemized $1,500 inside a bigger
    // withdrawal should still be findable by "1500".
    txnConds.push(
      sql`EXISTS (SELECT 1 FROM ${importedTransactionLines} l
        WHERE l.imported_transaction_id = ${importedTransactions.id}
          AND ${amountMatch(sql`l.amount`, numericQ)})`,
    );
  }
  const txnRows = await db
    .select({
      id: importedTransactions.id,
      date: importedTransactions.transactionDate,
      description: importedTransactions.description,
      payee: importedTransactions.payee,
      reference: importedTransactions.reference,
      amount: importedTransactions.amount,
      bankAccountId: importedTransactions.bankAccountId,
      accountName: bankAccounts.name,
      isIgnored: importedTransactions.isIgnored,
    })
    .from(importedTransactions)
    .innerJoin(
      bankAccounts,
      eq(bankAccounts.id, importedTransactions.bankAccountId),
    )
    .where(
      and(eq(importedTransactions.companyId, companyId), or(...txnConds)),
    )
    .orderBy(desc(importedTransactions.transactionDate))
    .limit(LIMIT + 1);

  // ---- Receipts / bills ----
  const rcptConds: SQL[] = [
    ilike(vendors.name, like),
    ilike(receipts.notes, like),
    sql`EXISTS (SELECT 1 FROM ${receiptLines} rl
      WHERE rl.receipt_id = ${receipts.id}
        AND rl.description ILIKE ${like})`,
  ];
  if (numericQ) {
    rcptConds.push(amountMatch(receipts.total, numericQ));
    rcptConds.push(amountMatch(receipts.subtotal, numericQ));
    rcptConds.push(
      sql`EXISTS (SELECT 1 FROM ${receiptLines} rl
        WHERE rl.receipt_id = ${receipts.id}
          AND (${amountMatch(sql`rl.total`, numericQ)} OR ${amountMatch(sql`rl.subtotal`, numericQ)}))`,
    );
  }
  const rcptRows = await db
    .select({
      id: receipts.id,
      date: receipts.receiptDate,
      vendorName: vendors.name,
      status: receipts.status,
      total: receipts.total,
      notes: receipts.notes,
    })
    .from(receipts)
    .leftJoin(vendors, eq(vendors.id, receipts.vendorId))
    .where(
      and(
        eq(receipts.companyId, companyId),
        sql`${receipts.deletedAt} IS NULL`,
        or(...rcptConds),
      ),
    )
    .orderBy(desc(receipts.receiptDate))
    .limit(LIMIT + 1);

  return {
    query,
    numeric: numericQ?.value ?? null,
    transactions: txnRows.slice(0, LIMIT).map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      payee: r.payee,
      reference: r.reference,
      amount: Number(r.amount),
      bankAccountId: r.bankAccountId,
      accountName: r.accountName,
      isIgnored: r.isIgnored,
    })),
    receipts: rcptRows.slice(0, LIMIT).map((r) => ({
      id: r.id,
      date: r.date,
      vendorName: r.vendorName,
      status: r.status,
      total: Number(r.total),
      notes: r.notes,
    })),
    truncated: txnRows.length > LIMIT || rcptRows.length > LIMIT,
  };
}
