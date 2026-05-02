import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
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

    // Section visibility toggles
    showCompanyBranding: boolean('show_company_branding').notNull().default(true),
    showHeader: boolean('show_header').notNull().default(true),
    showLineItems: boolean('show_line_items').notNull().default(true),
    showPaymentTerms: boolean('show_payment_terms').notNull().default(true),
    showRetainage: boolean('show_retainage').notNull().default(false),
    showTaxVat: boolean('show_tax_vat').notNull().default(true),
    showNotes: boolean('show_notes').notNull().default(true),
    showSignature: boolean('show_signature').notNull().default(true),
    showFooter: boolean('show_footer').notNull().default(true),

    // Layout choices
    headerLayout: text('header_layout').notNull().default('standard'),
    lineItemLayout: text('line_item_layout').notNull().default('detailed'),

    // Content overrides
    headerNote: text('header_note'),
    paymentTermsText: text('payment_terms_text'),
    retainageText: text('retainage_text'),
    notesText: text('notes_text'),
    footerText: text('footer_text'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('invoice_templates_company_idx').on(t.companyId),
  }),
);

export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;
export type NewInvoiceTemplate = typeof invoiceTemplates.$inferInsert;
