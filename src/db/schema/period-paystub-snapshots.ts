import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { employees } from './employees';
import { payPeriods } from './pay-periods';

// Frozen paystub for one (employee, pay_period) combo at lock time.
// When a period is locked, the action computes paystubs live one last
// time and writes them here. Subsequent reads of a locked period
// reconstruct paystubs from these rows instead of recomputing live —
// that's how rate changes on the employee record stop affecting
// already-posted pay.
//
// Unlocking a period clears these rows so future computes go live again.
//
// Unique on (pay_period_id, employee_id) — exactly one snapshot per
// employee per period.
export const periodPaystubSnapshots = pgTable(
  'period_paystub_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    payPeriodId: uuid('pay_period_id')
      .notNull()
      .references(() => payPeriods.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // Snapshot of identifying details so a deleted employee's locked
    // paystub still renders sensibly.
    employeeName: text('employee_name').notNull(),
    employmentType: text('employment_type').notNull(),
    // Frozen computed fields. These are the source of truth for the
    // paystub after the period is locked.
    payRate: numeric('pay_rate', { precision: 12, scale: 4 }).notNull(),
    hoursWorked: numeric('hours_worked', { precision: 7, scale: 2 })
      .notNull()
      .default('0'),
    gross: numeric('gross', { precision: 12, scale: 2 }).notNull().default('0'),
    // Phase 4.10: adjusted_gross = raw gross − deductions. NIB is
    // calculated off adjusted_gross. additions_total is the sum of
    // reimbursements + per_diem + expenses for this period (added to
    // net after NIB).
    adjustedGross: numeric('adjusted_gross', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    deductionsTotal: numeric('deductions_total', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    additionsTotal: numeric('additions_total', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    insurableWage: numeric('insurable_wage', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    employeeNib: numeric('employee_nib', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    employerNib: numeric('employer_nib', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    net: numeric('net', { precision: 12, scale: 2 }).notNull().default('0'),
    nibExempt: boolean('nib_exempt').notNull().default(false),
    // 'override' | 'rate' | 'none' — where the gross came from at lock
    // time. Surfaced on the paystub card so the user can tell why.
    grossSource: text('gross_source').notNull().default('none'),
    snapshottedAt: timestamp('snapshotted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('period_paystub_snapshots_company_idx').on(t.companyId),
    periodIdx: index('period_paystub_snapshots_period_idx').on(t.payPeriodId),
    uniqueEmpPeriod: uniqueIndex('period_paystub_snapshots_emp_period_uq').on(
      t.payPeriodId,
      t.employeeId,
    ),
  }),
);

export type PeriodPaystubSnapshot = typeof periodPaystubSnapshots.$inferSelect;
export type NewPeriodPaystubSnapshot =
  typeof periodPaystubSnapshots.$inferInsert;
