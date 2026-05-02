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
