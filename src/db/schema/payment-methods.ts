import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

// Per-company, user-managed payment methods ("Wire", "Zelle", "Company card",
// …) — created on the fly from the pickers, stamped onto expense details
// (bank/CC transactions and receipts), filterable on the Expense report.
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('payment_methods_company_idx').on(t.companyId),
  }),
);

export type PaymentMethod = typeof paymentMethods.$inferSelect;
