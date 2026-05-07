import { pgTable, uuid, text, timestamp, integer, numeric } from 'drizzle-orm/pg-core';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  licenseNumber: text('license_number'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  defaultCurrency: text('default_currency').notNull().default('USD'),
  defaultMarkupPercent: numeric('default_markup_percent', { precision: 6, scale: 3 })
    .notNull()
    .default('20'),
  taxRatePercent: numeric('tax_rate_percent', { precision: 6, scale: 3 })
    .notNull()
    .default('0'),
  vatRatePercent: numeric('vat_rate_percent', { precision: 6, scale: 3 })
    .notNull()
    .default('0'),
  proposalValidityDays: integer('proposal_validity_days').notNull().default(30),
  standardPaymentTerms: text('standard_payment_terms'),
  standardWarrantyLanguage: text('standard_warranty_language'),
  fiscalYearStartMonth: integer('fiscal_year_start_month').notNull().default(1),

  // Tax / banking — surfaced on invoices when the active template enables
  // wire-instruction or TIN sections. Nullable so existing companies keep
  // working with no data backfill.
  tinNumber: text('tin_number'),
  bankName: text('bank_name'),
  bankBranch: text('bank_branch'),
  bankAccountName: text('bank_account_name'),
  bankAccountNumber: text('bank_account_number'),
  bankAddress: text('bank_address'),
  paymentNotes: text('payment_notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
