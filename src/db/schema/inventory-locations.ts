import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

// Phase 6.4: physical stock locations (Main Yard, Truck 1, Job Site …).
// Exactly one location per company is the default (seeded as "Main Yard"
// for every existing company by the migration). Inventory_movements and
// po_receipts both carry a location_id pointing here.
//
// Soft-delete via archived_at: locations with movement history can't be
// hard-deleted without losing the audit trail, so we archive instead.
// Partial unique indexes (declared in the migration) enforce:
//   - one default per company (where is_default = true AND not archived)
//   - unique name per company (where not archived)
export const inventoryLocations = pgTable(
  'inventory_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    notes: text('notes'),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index('inventory_locations_company_idx').on(t.companyId),
  }),
);

export type InventoryLocation = typeof inventoryLocations.$inferSelect;
export type NewInventoryLocation = typeof inventoryLocations.$inferInsert;
