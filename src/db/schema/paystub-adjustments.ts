import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { employees } from './employees';
import { payPeriods } from './pay-periods';

// Per-employee, per-period paystub line items that adjust the paystub
// totals beyond gross + NIB.
//
//   deduction      → subtracted from gross BEFORE NIB (pre-NIB).
//                    Reduces insurable wages on the C-10.
//   reimbursement  → added to net, NIB-exempt.
//   per_diem       → added to net, NIB-exempt.
//   expense        → added to net, NIB-exempt.
//
// Multiple rows per (employee, period, type) are allowed — each row's
// description prints as its own line on the paystub.
export const adjustmentTypeValues = [
  'deduction',
  'reimbursement',
  'per_diem',
  'expense',
] as const;
export type AdjustmentType = (typeof adjustmentTypeValues)[number];

export const ADJUSTMENT_TYPE_LABEL: Record<AdjustmentType, string> = {
  deduction: 'Deduction',
  reimbursement: 'Reimbursement',
  per_diem: 'Per diem',
  expense: 'Expense',
};

export const paystubAdjustments = pgTable(
  'paystub_adjustments',
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
    type: text('type').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('paystub_adjustments_company_idx').on(t.companyId),
    periodIdx: index('paystub_adjustments_period_idx').on(t.payPeriodId),
    empPeriodIdx: index('paystub_adjustments_emp_period_idx').on(
      t.employeeId,
      t.payPeriodId,
    ),
  }),
);

export type PaystubAdjustment = typeof paystubAdjustments.$inferSelect;
export type NewPaystubAdjustment = typeof paystubAdjustments.$inferInsert;
