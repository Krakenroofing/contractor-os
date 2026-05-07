import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  numeric,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const invoiceTemplates = pgTable(
  'invoice_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),

    // ===== Phase 1 base toggles (existing) =====
    showCompanyBranding: boolean('show_company_branding').notNull().default(true),
    showHeader: boolean('show_header').notNull().default(true),
    showLineItems: boolean('show_line_items').notNull().default(true),
    showPaymentTerms: boolean('show_payment_terms').notNull().default(true),
    showRetainage: boolean('show_retainage').notNull().default(false),
    showTaxVat: boolean('show_tax_vat').notNull().default(true),
    showNotes: boolean('show_notes').notNull().default(true),
    showSignature: boolean('show_signature').notNull().default(true),
    showFooter: boolean('show_footer').notNull().default(true),

    // Layout choices (existing)
    headerLayout: text('header_layout').notNull().default('standard'),
    lineItemLayout: text('line_item_layout').notNull().default('detailed'),

    // Content overrides (existing)
    headerNote: text('header_note'),
    paymentTermsText: text('payment_terms_text'),
    retainageText: text('retainage_text'),
    notesText: text('notes_text'),
    footerText: text('footer_text'),

    // ===== Phase 1 additions =====
    //
    // Header customisation. titleOverride lets a template render as
    // "VAT Invoice", "Progress Invoice", "Request for Change Order", etc.
    // The default null falls back to "Invoice" in the renderer.
    titleOverride: text('title_override'),
    tinLabel: text('tin_label').notNull().default('TIN'),
    issuedByLabel: text('issued_by_label').notNull().default('Issued by'),

    // Bill-to extras
    showBillToTin: boolean('show_bill_to_tin').notNull().default(false),
    billToAttentionLabel: text('bill_to_attention_label')
      .notNull()
      .default('Attention'),

    // Project / payment metadata block
    showProjectMetadata: boolean('show_project_metadata').notNull().default(true),
    poNumberLabel: text('po_number_label').notNull().default('Purchase Order'),
    billingNumberLabel: text('billing_number_label')
      .notNull()
      .default('Billing #'),
    projectDescriptionLabel: text('project_description_label')
      .notNull()
      .default('Project description'),

    // Wire instructions section. Pulls bank fields from companies. The
    // template only controls visibility + a free-text payment note.
    showWireInstructions: boolean('show_wire_instructions')
      .notNull()
      .default(false),
    wireInstructionsNote: text('wire_instructions_note'),

    // Qualifications / exclusions block (separate from notes)
    showQualifications: boolean('show_qualifications').notNull().default(false),
    qualificationsText: text('qualifications_text'),

    // Account history: prior invoices for the same project
    showAccountHistory: boolean('show_account_history').notNull().default(false),
    accountHistoryLabel: text('account_history_label')
      .notNull()
      .default('Account history'),

    // Progress billing summary block
    showProgressBilling: boolean('show_progress_billing')
      .notNull()
      .default(false),
    progressBillingLabel: text('progress_billing_label')
      .notNull()
      .default('Progress billing'),
    contractValueLabel: text('contract_value_label')
      .notNull()
      .default('Total contract value'),
    changeOrdersLabel: text('change_orders_label')
      .notNull()
      .default('Approved change orders'),
    priorBilledLabel: text('prior_billed_label')
      .notNull()
      .default('Less previously billed'),
    retainageHeldLabel: text('retainage_held_label')
      .notNull()
      .default('Less retainage'),

    // VAT row in totals (separate from existing showTaxVat which gates the
    // tax block as a whole — vatRatePercent + vatLabel control how the row
    // is computed and rendered).
    vatLabel: text('vat_label').notNull().default('VAT'),
    vatRatePercent: numeric('vat_rate_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('invoice_templates_company_idx').on(t.companyId),
  }),
);

export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;
export type NewInvoiceTemplate = typeof invoiceTemplates.$inferInsert;
