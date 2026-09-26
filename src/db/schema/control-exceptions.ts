import { pgTable, uuid, text, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';

// Roadmap P6: every approval that bypassed separation of duties (an owner
// approving a PO or bill they entered) — with the reason — for review.
export const controlExceptions = pgTable(
  'control_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'po_self_approval' | 'bill_self_approval'>().notNull(),
    entityType: text('entity_type').$type<'purchase_order' | 'bill'>().notNull(),
    entityId: uuid('entity_id').notNull(),
    entityLabel: text('entity_label'),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('control_exceptions_company_idx').on(t.companyId, t.createdAt),
  }),
);

export type ControlException = typeof controlExceptions.$inferSelect;
