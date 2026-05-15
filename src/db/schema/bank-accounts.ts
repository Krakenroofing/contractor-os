import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { accountingAccounts } from './accounting-accounts';
import { bankAccountTypeEnum } from './_enums';

// Registry of real bank / credit-card accounts. Distinct from the free-text
// `bank_account` string on invoice_payments — that one is a label we render
// on the invoice, while this is the source of imported transactions.
//
// Every bank_account pairs 1:1 with an accounting_accounts row so future
// posting has a stable category target.
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    accountingAccountId: uuid('accounting_account_id')
      .notNull()
      .references(() => accountingAccounts.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    type: bankAccountTypeEnum('type').notNull(),
    last4: text('last4'),
    currency: text('currency').notNull().default('USD'),
    openingBalance: numeric('opening_balance', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    openingDate: date('opening_date'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('bank_accounts_company_idx').on(t.companyId),
  }),
);

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
