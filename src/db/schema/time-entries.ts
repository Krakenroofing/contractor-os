import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { employees } from './employees';
import { payPeriods } from './pay-periods';
import { projects } from './projects';
import { costCodes } from './cost-codes';

// One row = one employee's hours on one date, optionally allocated to a
// project + cost code. The "general timesheet" view sums these per
// (employee, date); the "by job" view groups by project. Same data, two
// pivots.
//
// Distinct from job_costs.labor_entries which carry worker_name as a free
// string; those keep working for the existing job-cost flow. Eventually
// the two should be unified — see Phase 5 polish.
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    payPeriodId: uuid('pay_period_id')
      .notNull()
      .references(() => payPeriods.id, { onDelete: 'cascade' }),
    workDate: date('work_date').notNull(),
    // 'hours' = traditional timesheet row (hours × rate drives pay).
    // 'amount' = direct pay-amount row used for piecework / contract /
    // commission / lump-sum employees who aren't billed by the hour.
    // Both types co-exist in this table so the timesheet UI is a single
    // entry point regardless of how the employee gets paid.
    entryType: text('entry_type').notNull().default('hours'),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull().default('0'),
    // Pay amount for entry_type='amount' rows. Zero for hours rows.
    amount: numeric('amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    costCodeId: uuid('cost_code_id').references(() => costCodes.id, {
      onDelete: 'set null',
    }),
    // True when this row represents overhead labor (admin, training,
    // equipment maintenance) rather than work tied to a specific job.
    // When true, project_id stays null. Reports group overhead
    // separately from "Unassigned" rows that just haven't been
    // allocated to a job yet.
    isOverhead: boolean('is_overhead').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('time_entries_company_idx').on(t.companyId),
    periodIdx: index('time_entries_period_idx').on(t.payPeriodId),
    employeeIdx: index('time_entries_employee_idx').on(t.employeeId),
    projectIdx: index('time_entries_project_idx').on(t.projectId),
  }),
);

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
