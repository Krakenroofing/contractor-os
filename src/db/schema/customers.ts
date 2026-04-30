import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { customerTypeEnum } from './_enums';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    primaryContactName: text('primary_contact_name'),
    email: text('email'),
    phone: text('phone'),
    customerType: customerTypeEnum('customer_type').notNull().default('residential'),
    billingAddressLine1: text('billing_address_line1'),
    billingAddressLine2: text('billing_address_line2'),
    billingCity: text('billing_city'),
    billingState: text('billing_state'),
    billingPostalCode: text('billing_postal_code'),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('customers_company_idx').on(t.companyId),
  }),
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
