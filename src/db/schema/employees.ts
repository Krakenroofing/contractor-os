import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

// Employees are the people we pay through payroll (distinct from `users` who
// log into the app, and from `vendors` who are external companies we issue
// POs to). NIB calculations and weekly paystubs key off this table.
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    // Bahamas National Insurance Board number. Free text — format varies,
    // and validation belongs at the form layer, not the DB.
    nibNumber: text('nib_number'),
    email: text('email'),
    phone: text('phone'),
    // 'hourly' → payRate is dollars/hour; gross = hours × rate
    // 'salaried' → payRate is dollars/week; gross = payRate regardless of hours
    employmentType: text('employment_type').notNull().default('hourly'),
    payRate: numeric('pay_rate', { precision: 12, scale: 4 }).notNull().default('0'),
    hireDate: date('hire_date'),
    terminationDate: date('termination_date'),
    active: boolean('active').notNull().default(true),
    // Skip NIB calculations for this employee entirely. For expats and
    // anyone not covered by Bahamas NIB. When true, paystub shows no NIB
    // lines and the C-10 summary excludes them.
    nibExempt: boolean('nib_exempt').notNull().default(false),
    // NIB coverage began on this date: pay periods ENDING before it get no
    // NIB (as if exempt) and are left off the C-10; periods ending on/after
    // it calculate NIB normally. For people added to payroll mid-year whose
    // earlier pay predates their NIB registration. Null = covered from the
    // start; nibExempt=true overrides this entirely.
    nibStartDate: date('nib_start_date'),
    // Economically a subcontractor (typically NIB-exempt) even though they
    // run through payroll for time/pay mechanics. Routes their labor cost to
    // the Subcontractors COGS category (job-cost posting, P&L payroll
    // source, payroll-bill GL) instead of Direct Labor / Payroll Expenses.
    isSubcontractor: boolean('is_subcontractor').notNull().default(false),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('employees_company_idx').on(t.companyId),
    activeIdx: index('employees_active_idx').on(t.companyId, t.active),
  }),
);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
