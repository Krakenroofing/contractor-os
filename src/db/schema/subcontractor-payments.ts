import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { vendors } from './vendors';
import { projects } from './projects';

// Subcontractor payments are outflows we owe a sub for completed scope.
// Distinct from job_costs.subcontractor entries (which record cost
// incurred) — this table tracks the payment LIFECYCLE: draft → approved
// → paid (with retainage potentially still held).
//
// Each row carries the gross billed amount, the retainage % per the deal,
// the current retainage_held, and net_paid. When retainage gets released,
// edit the row to drop retainage_held to 0 and bump net_paid to gross.
// A proper release-event log is Phase 5 polish.
export const subcontractorPayments = pgTable(
  'subcontractor_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    // Project allocation is optional — a sub might do general work that
    // isn't tied to a specific job (warehouse, equipment maintenance, etc.).
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    workPeriodStart: date('work_period_start').notNull(),
    workPeriodEnd: date('work_period_end').notNull(),
    // Free-text description of what was done. The "scope area completed"
    // the user described — what justifies the payment.
    scopeDescription: text('scope_description').notNull(),
    grossAmount: numeric('gross_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    // Percentage withheld per the contract (e.g. 10.000 for 10%).
    retainagePercent: numeric('retainage_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    // Dollars currently held back. Starts at gross × retainage% on create,
    // edited downward when retainage is released.
    retainageHeld: numeric('retainage_held', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    // Dollars actually paid out so far. gross - retainage_held; stored so
    // it doesn't drift from the source.
    netPaid: numeric('net_paid', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    paidDate: date('paid_date'),
    // 'draft' | 'approved' | 'paid' | 'void'. paid means net_paid has hit
    // the bank; retainage_held may still be > 0 (held for warranty/final).
    status: text('status').notNull().default('draft'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('subcontractor_payments_company_idx').on(t.companyId),
    vendorIdx: index('subcontractor_payments_vendor_idx').on(t.vendorId),
    projectIdx: index('subcontractor_payments_project_idx').on(t.projectId),
    periodIdx: index('subcontractor_payments_period_idx').on(
      t.companyId,
      t.workPeriodStart,
    ),
  }),
);

export type SubcontractorPayment = typeof subcontractorPayments.$inferSelect;
export type NewSubcontractorPayment = typeof subcontractorPayments.$inferInsert;
