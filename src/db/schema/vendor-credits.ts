import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { vendors } from './vendors';
import { accountingAccounts } from './accounting-accounts';
import { receipts } from './receipts';
import { users } from './users';

// A credit note from a vendor: reduces what we owe them. At creation it
// posts Dr Accounts Payable / Cr <expense category> (source 'vendor_credit');
// applications spread the credit across bills (receipts) so a bill's
// remaining due = total − applied credits — the figure the bank payment
// should match during reconciliation.
export const vendorCredits = pgTable(
  'vendor_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    creditDate: date('credit_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    // The expense category this credit reduces — required; drives the P&L
    // contra line and the GL credit side.
    accountingAccountId: uuid('accounting_account_id')
      .notNull()
      .references(() => accountingAccounts.id, { onDelete: 'restrict' }),
    reference: text('reference'),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index('vendor_credits_company_idx').on(t.companyId),
    vendorIdx: index('vendor_credits_vendor_idx').on(t.vendorId),
  }),
);

export type VendorCredit = typeof vendorCredits.$inferSelect;
export type NewVendorCredit = typeof vendorCredits.$inferInsert;

export const vendorCreditApplications = pgTable(
  'vendor_credit_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    creditId: uuid('credit_id')
      .notNull()
      .references(() => vendorCredits.id, { onDelete: 'cascade' }),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    creditIdx: index('vendor_credit_applications_credit_idx').on(t.creditId),
    receiptIdx: index('vendor_credit_applications_receipt_idx').on(t.receiptId),
    companyIdx: index('vendor_credit_applications_company_idx').on(t.companyId),
  }),
);

export type VendorCreditApplication =
  typeof vendorCreditApplications.$inferSelect;
export type NewVendorCreditApplication =
  typeof vendorCreditApplications.$inferInsert;
