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
