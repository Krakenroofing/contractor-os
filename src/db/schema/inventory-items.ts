import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { costCodes } from './cost-codes';
import { vendors } from './vendors';

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'),
    sku: text('sku'),
    unit: text('unit'),
    defaultCost: numeric('default_cost', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    defaultCostCodeId: uuid('default_cost_code_id').references(() => costCodes.id, {
      onDelete: 'set null',
    }),
    // Default accounting category (GL account) for PO/bill lines of this
    // product. FK in SQL (accounting_accounts would cycle here).
    defaultAccountingAccountId: uuid('default_accounting_account_id'),
    // Usual supplier, set by hand. Null = the inventory list derives it from
    // the latest PO the product was received on.
    supplierVendorId: uuid('supplier_vendor_id').references(() => vendors.id, {
      onDelete: 'set null',
    }),
    isTaxable: boolean('is_taxable').notNull().default(true),
    qbGlAccountText: text('qb_gl_account_text'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('inventory_items_company_idx').on(t.companyId),
    companySkuUniq: uniqueIndex('inventory_items_company_sku_uniq').on(t.companyId, t.sku),
  }),
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
