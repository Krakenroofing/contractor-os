// "Accounting to-do" — bank transactions that have a categorization problem
// the operator should fix. Two issue types:
//
//   reviewed_no_category — marked reviewed but has no category and no split
//                          lines (it slipped through the queue uncategorized).
//   incomplete_split     — split into lines but at least one line has no
//                          category (e.g. a VAT split where the cost line was
//                          left to "categorize later").
//
// Excludes ignored + reconciled rows. DB-only (the imported ledger is not in
// the mock store) → returns [] in demo mode.

import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { importedTransactions } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type AccountingReviewItem = {
  id: string;
  bankAccountId: string;
  transactionDate: string;
  description: string;
  amount: string;
  isReviewed: boolean;
  lineCount: number;
  uncategorizedLines: number;
  issue: 'reviewed_no_category' | 'incomplete_split';
};

export async function listAccountingReviewItems(
  companyId: string,
): Promise<AccountingReviewItem[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const lineCount = sql<number>`(select count(*) from imported_transaction_lines l where l.imported_transaction_id = ${importedTransactions.id})`;
  const uncategorizedLines = sql<number>`(select count(*) from imported_transaction_lines l where l.imported_transaction_id = ${importedTransactions.id} and l.accounting_account_id is null)`;
  const rows = await db
    .select({
      id: importedTransactions.id,
      bankAccountId: importedTransactions.bankAccountId,
      transactionDate: importedTransactions.transactionDate,
      description: importedTransactions.description,
      amount: importedTransactions.amount,
      isReviewed: importedTransactions.isReviewed,
      lineCount,
      uncategorizedLines,
    })
    .from(importedTransactions)
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        eq(importedTransactions.isIgnored, false),
        isNull(importedTransactions.reconciledAt),
        sql`(
          (${importedTransactions.isReviewed} = true
            and ${importedTransactions.accountingAccountId} is null
            and not exists (select 1 from imported_transaction_lines l where l.imported_transaction_id = ${importedTransactions.id}))
          or exists (select 1 from imported_transaction_lines l where l.imported_transaction_id = ${importedTransactions.id} and l.accounting_account_id is null)
        )`,
      ),
    )
    .orderBy(desc(importedTransactions.transactionDate));

  return rows.map((r) => {
    const lc = Number(r.lineCount);
    return {
      id: r.id,
      bankAccountId: r.bankAccountId,
      transactionDate: r.transactionDate,
      description: r.description,
      amount: r.amount,
      isReviewed: r.isReviewed,
      lineCount: lc,
      uncategorizedLines: Number(r.uncategorizedLines),
      issue: lc > 0 ? 'incomplete_split' : 'reviewed_no_category',
    };
  });
}
