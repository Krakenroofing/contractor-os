import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { users } from './users';
import { bankAccounts } from './bank-accounts';

// Phase 1 banking rules. Classification assistance only — never posts to
// job_cost_entries, never creates invoices/payments. Matchers AND together;
// actions are applied verbatim onto an imported_transactions row when the
// operator clicks Apply.
export const bankingRules = pgTable(
  'banking_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    // Lower priority wins. Default 100. Specific rules → lower, broad → higher.
    priority: integer('priority').notNull().default(100),
    // 'suggest' | 'auto_apply'. Phase 1 UI never honors 'auto_apply'.
    mode: text('mode').notNull().default('suggest'),
    // 'all' | 'debits' | 'credits'
    appliesTo: text('applies_to').notNull().default('all'),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, {
      onDelete: 'cascade',
    }),
    amountMin: numeric('amount_min', { precision: 14, scale: 2 }),
    amountMax: numeric('amount_max', { precision: 14, scale: 2 }),
    matchers: jsonb('matchers').notNull().default(sql`'[]'::jsonb`),
    actions: jsonb('actions').notNull().default(sql`'{}'::jsonb`),
    matchCount: integer('match_count').notNull().default(0),
    lastMatchedAt: timestamp('last_matched_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index('banking_rules_company_idx').on(t.companyId),
    companyPriorityIdx: index('banking_rules_company_priority_idx')
      .on(t.companyId, t.priority)
      .where(sql`${t.deletedAt} IS NULL AND ${t.enabled} = true`),
  }),
);

export type BankingRule = typeof bankingRules.$inferSelect;
export type NewBankingRule = typeof bankingRules.$inferInsert;
