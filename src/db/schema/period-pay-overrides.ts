import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { employees } from './employees';
import { payPeriods } from './pay-periods';

// One employee's manually-entered gross pay for one weekly period.
// When present, this overrides the auto-computed gross from time entries
// or stored pay rate. Used for piecework, commission, contract, and
// lump-sum employees whose pay varies week-to-week, AND as an
// occasional override for hourly/salaried employees (bonus, makeup pay,
// etc.).
//
// Unique on (employee_id, pay_period_id) — one override per pair. Use
// upsert at the data layer.
export const periodPayOverrides = pgTable(
  'period_pay_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    payPeriodId: uuid('pay_period_id')
      .notNull()
      .references(() => payPeriods.id, { onDelete: 'cascade' }),
    grossAmount: numeric('gross_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('period_pay_overrides_company_idx').on(t.companyId),
    periodIdx: index('period_pay_overrides_period_idx').on(t.payPeriodId),
    uniqueEmpPeriod: uniqueIndex('period_pay_overrides_emp_period_uq').on(
      t.employeeId,
      t.payPeriodId,
    ),
  }),
);

export type PeriodPayOverride = typeof periodPayOverrides.$inferSelect;
export type NewPeriodPayOverride = typeof periodPayOverrides.$inferInsert;
