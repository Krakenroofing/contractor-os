import {
  pgTable,
  uuid,
  date,
  integer,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { employees } from './employees';
import { payPeriods } from './pay-periods';

// Unpaid lunch-break overrides. The deduction defaults by the day's hours
// (60 min if >= 6h worked, 30 min if under, 0 if none) — that default is
// computed, not stored. A row exists here only when a day's lunch was edited
// away from the default (including to 0 = "no lunch"). One row per
// (employee, work_date).
export const timesheetLunchOverrides = pgTable(
  'timesheet_lunch_overrides',
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
    workDate: date('work_date').notNull(),
    minutes: integer('minutes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    periodIdx: index('timesheet_lunch_overrides_period_idx').on(t.payPeriodId),
    employeeDateUq: unique('timesheet_lunch_overrides_employee_date_key').on(
      t.employeeId,
      t.workDate,
    ),
  }),
);

export type TimesheetLunchOverride = typeof timesheetLunchOverrides.$inferSelect;
