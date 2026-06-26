import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { users } from './users';
import { importedTransactions } from './statement-imports';
import { invoicePayments } from './invoices';
import { receipts } from './receipts';
import { jobCostEntries } from './job-costs';
import { payrollBills } from './payroll-bills';

// One row per match attempt linking an imported_transactions row to:
//   - an invoice_payment (AR side, money in)
//   - a posted receipt   (AP side, money out)
//   - a job_cost_entry   (manual expense)
//   - another imported_transactions row (transfer pair)
//   - owner_contribution / owner_draw (no FK; equity tagging only)
//
// Active-match uniqueness is enforced at the SQL layer via partial unique
// indexes. Drizzle just declares the columns; the indexes live in
// 2026-05-15_reconciliation_matching_phase1.sql.
export const transactionMatches = pgTable(
  'transaction_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    importedTransactionId: uuid('imported_transaction_id')
      .notNull()
      .references(() => importedTransactions.id, { onDelete: 'cascade' }),

    // 'invoice_payment' | 'receipt' | 'job_cost_entry' | 'transfer'
    // | 'owner_contribution' | 'owner_draw'
    matchType: text('match_type').notNull(),

    invoicePaymentId: uuid('invoice_payment_id').references(
      () => invoicePayments.id,
      { onDelete: 'cascade' },
    ),
    receiptId: uuid('receipt_id').references(() => receipts.id, {
      onDelete: 'cascade',
    }),
    jobCostEntryId: uuid('job_cost_entry_id').references(
      () => jobCostEntries.id,
      { onDelete: 'cascade' },
    ),
    payrollBillId: uuid('payroll_bill_id').references(() => payrollBills.id, {
      onDelete: 'cascade',
    }),
    transferPairedTxnId: uuid('transfer_paired_txn_id').references(
      (): AnyPgColumn => importedTransactions.id,
      { onDelete: 'cascade' },
    ),

    // 'exact' | 'high' | 'low' | 'manual'
    confidence: text('confidence').notNull().default('manual'),
    matchedAt: timestamp('matched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    matchedByUserId: uuid('matched_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),

    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedByUserId: uuid('reversed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('transaction_matches_company_idx').on(t.companyId),
    txnActiveUniq: uniqueIndex('transaction_matches_txn_active_uniq')
      .on(t.companyId, t.importedTransactionId)
      .where(sql`${t.reversedAt} IS NULL`),
  }),
);

export type TransactionMatch = typeof transactionMatches.$inferSelect;
export type NewTransactionMatch = typeof transactionMatches.$inferInsert;

export const MATCH_TYPES = [
  'invoice_payment',
  'receipt',
  'payroll_bill',
  'job_cost_entry',
  'transfer',
  'owner_contribution',
  'owner_draw',
] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_CONFIDENCES = ['exact', 'high', 'low', 'manual'] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number];
