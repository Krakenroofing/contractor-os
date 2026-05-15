import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { accountingAccountTypeEnum } from './_enums';

// Phase 1 lightweight Chart of Accounts. Not a full GL — used only as the
// "category" target for imported transactions and (Phase 2) receipts. A
// real double-entry ledger is deferred.
//
// `code` is optional. Auto-created bank/credit-card accounts have null code.
// User-created income/expense categories typically carry a code like
// '4000' (Sales) or '6100' (Materials), enforced unique per company when set.
export const accountingAccounts = pgTable(
  'accounting_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    code: text('code'),
    name: text('name').notNull(),
    type: accountingAccountTypeEnum('type').notNull(),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => accountingAccounts.id,
      { onDelete: 'set null' },
    ),
    currency: text('currency').notNull().default('USD'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('accounting_accounts_company_idx').on(t.companyId),
    companyTypeIdx: index('accounting_accounts_company_type_idx').on(
      t.companyId,
      t.type,
    ),
    companyCodeUniq: uniqueIndex('accounting_accounts_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.code} IS NOT NULL`),
  }),
);

export type AccountingAccount = typeof accountingAccounts.$inferSelect;
export type NewAccountingAccount = typeof accountingAccounts.$inferInsert;
