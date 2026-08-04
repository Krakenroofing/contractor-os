import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
} from 'drizzle-orm/pg-core';
import { accountingMethodEnum } from './_enums';

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

  // Accounting Settings (2026-06-25). default_retainage_percent auto-fills the
  // retainage % on a new invoice when there's no prior invoice on the project
  // to copy from. retainage_revenue_basis controls when held retainage hits
  // P&L income: 'billed' = recognize net-of-retainage now + held part at
  // release (current); 'accrual' = recognize the full value when first billed.
  defaultRetainagePercent: numeric('default_retainage_percent', {
    precision: 6,
    scale: 3,
  })
    .notNull()
    .default('0'),
  retainageRevenueBasis: text('retainage_revenue_basis')
    .$type<'billed' | 'accrual'>()
    .notNull()
    .default('billed'),

  // Payroll → job costs posting targets (Settings → Accounting). Wages post
  // to laborCogsAccountId (COGS); employer NIB / burden posts to
  // laborBurdenAccountId (separate). Null until configured — posting refuses
  // a pay period until both are set.
  laborCogsAccountId: uuid('labor_cogs_account_id'),
  laborBurdenAccountId: uuid('labor_burden_account_id'),

  // Banking & Receipts (Phase 1). Gate VAT-aware UI/logic on `isVatActive`
  // instead of `vatRatePercent > 0` so a company can mark itself VAT-active
  // ahead of choosing a rate, and so explicit opt-out is possible. Backfilled
  // by the 2026-05-15_banking_phase1 migration.
  isVatActive: boolean('is_vat_active').notNull().default(false),
  vatJurisdiction: text('vat_jurisdiction'),
  accountingMethod: accountingMethodEnum('accounting_method')
    .notNull()
    .default('accrual'),

  // Tax / banking — surfaced on invoices when the active template enables
  // wire-instruction or TIN sections. Nullable so existing companies keep
  // working with no data backfill.
  tinNumber: text('tin_number'),
  bankName: text('bank_name'),
  bankBranch: text('bank_branch'),
  // US-style ACH routing number. When set, invoice wire-instruction blocks
  // render US labels (Beneficiary / Bank / Routing (ACH) / Account number)
  // instead of the Bahamas-style Bank / Branch / Account name layout.
  bankRoutingNumber: text('bank_routing_number'),
  bankAccountName: text('bank_account_name'),
  bankAccountNumber: text('bank_account_number'),
  bankAddress: text('bank_address'),
  paymentNotes: text('payment_notes'),

  // Phase M6.3: when true, punch-out immediately marks the session
  // reviewed (by the worker) and posts it to time_entries — no admin
  // review step. Off by default; flip on per-company once you trust
  // the punch data. Toggle lives on /clock.
  autoPostClockSessions: boolean('auto_post_clock_sessions')
    .notNull()
    .default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
