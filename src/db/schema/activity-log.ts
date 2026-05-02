import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    // entityType: 'estimate' | 'proposal' | 'change_order' | 'purchase_order' |
    //             'invoice' | 'payment' | 'retainage_release' | ...
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    // kind: 'created' | 'status_changed' | 'edited' | 'approved' | 'released'
    kind: text('kind').notNull(),
    // Plain-English summary, e.g. "Status: draft → submitted" or "Total $1,425 → $1,500".
    summary: text('summary').notNull(),
    // Captured from getActiveRole() at the time of the event.
    actorRole: text('actor_role'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    entityIdx: index('activity_log_entity_idx').on(t.entityType, t.entityId),
    companyIdx: index('activity_log_company_idx').on(t.companyId),
  }),
);

export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type NewActivityLogEntry = typeof activityLog.$inferInsert;
