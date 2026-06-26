import {
  pgTable,
  uuid,
  date,
  numeric,
  text,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { employees } from './employees';
import { payPeriods } from './pay-periods';

// One QB-style payroll bill per employee per pay period. Records the accrual
// (gross / NIB / additions / deductions / net); net is the payable the bank
// payment settles. Double-entry GL is posted separately (source 'payroll_bill').
export const payrollBills = pgTable(
  'payroll_bills',
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
    billDate: date('bill_date').notNull(),
    gross: numeric('gross', { precision: 14, scale: 2 }).notNull().default('0'),
    employeeNib: numeric('employee_nib', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    employerNib: numeric('employer_nib', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    additions: numeric('additions', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    deductions: numeric('deductions', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    net: numeric('net', { precision: 14, scale: 2 }).notNull().default('0'),
    status: text('status').$type<'open' | 'paid' | 'void'>().notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    periodIdx: index('payroll_bills_period_idx').on(t.companyId, t.payPeriodId),
    employeePeriodUq: unique('payroll_bills_employee_period_key').on(
      t.employeeId,
      t.payPeriodId,
    ),
  }),
);

export type PayrollBill = typeof payrollBills.$inferSelect;
