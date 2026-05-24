import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { inventoryItems } from './inventory-items';
import { users } from './users';
import { poReceiptLines } from './purchase-orders';
import { projects } from './projects';
import { inventoryMovementTypeEnum } from './_enums';

// Phase 6.3: append-only inventory ledger. One row per change to on-hand.
// On-hand = SUM(quantity) per (company_id, inventory_item_id). Reversals
// are NEW rows (movement_type='adjustment' or matching reverse type) that
// reference the original via reversalOfId — we never DELETE history.
//
// Free-text PO lines without an inventory_item_id do NOT generate
// movements. They're cost-only, not stock.
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    movementType: inventoryMovementTypeEnum('movement_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),

    // Source refs — populated based on movementType. Nullable so adjustments
    // (which have no source doc) and Phase 6.4 transfers (which use their
    // own table) don't need every field.
    // SET NULL (not CASCADE) so undoing a receipt can write a reversal row
    // first and let the cascade orphan the original's source link without
    // destroying the audit trail. See deletePoReceipt for the flow.
    poReceiptLineId: uuid('po_receipt_line_id').references(
      () => poReceiptLines.id,
      { onDelete: 'set null' },
    ),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    reversalOfId: uuid('reversal_of_id').references(
      (): AnyPgColumn => inventoryMovements.id,
      { onDelete: 'set null' },
    ),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyItemIdx: index('inventory_movements_company_item_idx').on(
      t.companyId,
      t.inventoryItemId,
    ),
    poReceiptLineIdx: index('inventory_movements_po_receipt_line_idx').on(
      t.poReceiptLineId,
    ),
  }),
);

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;
