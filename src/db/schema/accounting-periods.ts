import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';

// Monthly posting periods per company. No row = OPEN. When a month is
// closed, database triggers (migration 2026-09-26_accounting_periods.sql)
// refuse any write that would post, change, delete, or re-date a record
// into it. Only the owner reopens; every close/reopen is logged.
export const accountingPeriods = pgTable(
  'accounting_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** First day of the month. */
    periodStart: date('period_start').notNull(),
    status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** { accountId: [debit, credit] } for the month, taken at close. */
    glSnapshot: jsonb('gl_snapshot').$type<Record<string, [number, number]>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyStartUq: unique('accounting_periods_company_start_uq').on(
      t.companyId,
      t.periodStart,
    ),
  }),
);

export const accountingPeriodLog = pgTable(
  'accounting_period_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    action: text('action').$type<'closed' | 'reopened'>().notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('accounting_period_log_company_idx').on(
      t.companyId,
      t.createdAt,
    ),
  }),
);

export type AccountingPeriod = typeof accountingPeriods.$inferSelect;
export type AccountingPeriodLogEntry = typeof accountingPeriodLog.$inferSelect;
