import { pgTable, uuid, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { vendors } from './vendors';
import { inventoryItems } from './inventory-items';
import { costCodes } from './cost-codes';

// Roadmap P4: a supplier's own item number (ABC, Gulfeagle, QXO …) mapped
// to one catalog item, so a PO / invoice line in the vendor's numbering
// resolves to the same product. Unique per (company, vendor, number) —
// case/space-insensitive, enforced by an expression index in SQL.
export const vendorItemNumbers = pgTable(
  'vendor_item_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    vendorItemNumber: text('vendor_item_number').notNull(),
    vendorDescription: text('vendor_description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemIdx: index('vendor_item_numbers_item_idx').on(t.inventoryItemId),
  }),
);

export type VendorItemNumber = typeof vendorItemNumbers.$inferSelect;

// Default cost code per inventory category; an item's own default wins.
export const inventoryCategoryCostCodes = pgTable(
  'inventory_category_cost_codes',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    costCodeId: uuid('cost_code_id').references(() => costCodes.id, {
      onDelete: 'cascade',
    }),
    // Default accounting category for the category's products (FK in SQL).
    accountingAccountId: uuid('accounting_account_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.category] }),
  }),
);

export type InventoryCategoryCostCode = typeof inventoryCategoryCostCodes.$inferSelect;
