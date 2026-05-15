import { pgTable, uuid, text, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    primaryContactName: text('primary_contact_name'),
    email: text('email'),
    phone: text('phone'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    defaultTerms: text('default_terms'),
    taxIdLast4: text('tax_id_last4'),
    isSubcontractor: boolean('is_subcontractor').notNull().default(false),
    w9OnFile: boolean('w9_on_file').notNull().default(false),
    notes: text('notes'),
    // Vendor Defaults — Phase 1. Read by the Receipt form to prefill cost
    // code / cost type / accounting category. All nullable. FK references
    // declared at the SQL layer in 2026-05-15_vendor_defaults_phase1.sql;
    // here we store the ids only (cost_codes and accounting_accounts can't
    // be imported cleanly because of cycles).
    defaultCostCodeId: uuid('default_cost_code_id'),
    defaultCostType: text('default_cost_type'),
    defaultAccountingAccountId: uuid('default_accounting_account_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('vendors_company_idx').on(t.companyId),
  }),
);

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
