import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

// Payroll periods are weekly buckets (Mon–Sun) that group time entries.
// A period is created on-demand the first time someone enters time inside
// it. Once "locked", entries can no longer be edited — that's the close-out
// signal for downstream NIB filing.
export const payPeriods = pgTable(
  'pay_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    // 'open' | 'locked'. Locking prevents further time entry edits so a
    // closed payroll run can't be retroactively rewritten.
    status: text('status').notNull().default('open'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('pay_periods_company_idx').on(t.companyId),
    // One period per (company, start_date) — the lookup key when "find or
    // create the period containing 2026-05-19" runs.
    uniqueStart: uniqueIndex('pay_periods_company_start_uq').on(
      t.companyId,
      t.startDate,
    ),
  }),
);

export type PayPeriod = typeof payPeriods.$inferSelect;
export type NewPayPeriod = typeof payPeriods.$inferInsert;
