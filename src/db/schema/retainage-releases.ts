import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { invoices, invoicePayments } from './invoices';
import { projects } from './projects';

export const retainageReleases = pgTable(
  'retainage_releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').references(() => invoicePayments.id, {
      onDelete: 'set null',
    }),
    releaseNumber: text('release_number').notNull().default(''),
    releaseDate: date('release_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    // VAT on the released retention — becomes payable at release (Bahamas DIR
    // retention rule). Rate is the original invoice's effective VAT rate; 0 for
    // non-VAT companies. `amount` stays the net retention principal.
    vatRate: numeric('vat_rate', { precision: 6, scale: 3 }).notNull().default('0'),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    invoiceIdx: index('retainage_releases_invoice_idx').on(t.invoiceId),
    projectIdx: index('retainage_releases_project_idx').on(t.projectId),
    companyNumberUniq: uniqueIndex('retainage_releases_company_number_uniq').on(
      t.companyId,
      t.releaseNumber,
    ),
  }),
);

export type RetainageRelease = typeof retainageReleases.$inferSelect;
export type NewRetainageRelease = typeof retainageReleases.$inferInsert;
