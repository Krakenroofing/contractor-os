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
    // lines and the C17 summary excludes them.
    nibExempt: boolean('nib_exempt').notNull().default(false),
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
