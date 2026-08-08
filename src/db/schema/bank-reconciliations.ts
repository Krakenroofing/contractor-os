import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { bankAccounts } from './bank-accounts';
import { users } from './users';

// Bank statement reconciliation (QB-style). One row per statement period per
// bank account. Transactions cleared in a reconciliation carry its id in
// imported_transactions.bank_reconciliation_id (NULL = uncleared, rolls
// forward to the next reconciliation). Completing requires the cleared math
// to tie: beginning + cleared deposits − cleared payments = ending balance.
//
// NOT the same thing as imported_transactions.reconciled_at — that flag means
// "matched to a receipt / bill / invoice payment" (document matching).
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    statementDate: date('statement_date').notNull(),
    beginningBalance: numeric('beginning_balance', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    endingBalance: numeric('ending_balance', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    // 'in_progress' | 'completed'
    status: text('status').notNull().default('in_progress'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
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
    companyIdx: index('bank_reconciliations_company_idx').on(t.companyId),
    accountIdx: index('bank_reconciliations_account_idx').on(
      t.bankAccountId,
      t.statementDate,
    ),
    // Only one open reconciliation per account at a time.
    oneOpenUq: uniqueIndex('bank_reconciliations_one_open_uq')
      .on(t.bankAccountId)
      .where(sql`${t.status} = 'in_progress'`),
  }),
);

export type BankReconciliation = typeof bankReconciliations.$inferSelect;
export type NewBankReconciliation = typeof bankReconciliations.$inferInsert;
