import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { vendors } from './vendors';
import { users } from './users';
import { costCodes } from './cost-codes';
import { landedCosts } from './landed-costs';
import { inventoryItems } from './inventory-items';
import { inventoryLocations } from './inventory-locations';
import { purchaseOrderStatusEnum } from './_enums';

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    landedCostEntryId: uuid('landed_cost_entry_id').references(() => landedCosts.id, {
      onDelete: 'set null',
    }),
    number: text('number').notNull(),
    status: purchaseOrderStatusEnum('status').notNull().default('draft'),
    issueDate: date('issue_date'),
    expectedDeliveryDate: date('expected_delivery_date'),
    shipToAddressLine1: text('ship_to_address_line1'),
    shipToCity: text('ship_to_city'),
    shipToState: text('ship_to_state'),
    shipToPostalCode: text('ship_to_postal_code'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    shipping: numeric('shipping', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    // The supplier's own invoice number, recorded when their bill arrives
    // for this PO (any status — invoices land long after issue). Shown on
    // the AP aging report so commitments tie to vendor paperwork.
    vendorInvoiceNumber: text('vendor_invoice_number'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('purchase_orders_project_idx').on(t.projectId),
    vendorIdx: index('purchase_orders_vendor_idx').on(t.vendorId),
    companyNumberUniq: uniqueIndex('purchase_orders_company_number_uniq').on(
      t.companyId,
      t.number,
    ),
  }),
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    costCodeId: uuid('cost_code_id')
      .notNull()
      .references(() => costCodes.id, { onDelete: 'restrict' }),
    inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    unit: text('unit'),
    quantityOrdered: numeric('quantity_ordered', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    quantityReceived: numeric('quantity_received', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0'),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    poIdx: index('purchase_order_lines_po_idx').on(t.purchaseOrderId),
  }),
);

export const poReceipts = pgTable('po_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  receivedByUserId: uuid('received_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  // Phase 6.4: which physical location received this shipment. One
  // location per whole receipt — every inventory_movement written for
  // its lines inherits it. Nullable for legacy rows; new writes always
  // populate via the receive form's location picker.
  locationId: uuid('location_id').references(() => inventoryLocations.id, {
    onDelete: 'set null',
  }),
});

export const poReceiptLines = pgTable('po_receipt_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id')
    .notNull()
    .references(() => poReceipts.id, { onDelete: 'cascade' }),
  poLineId: uuid('po_line_id')
    .notNull()
    .references(() => purchaseOrderLines.id, { onDelete: 'cascade' }),
  quantityReceived: numeric('quantity_received', { precision: 14, scale: 4 })
    .notNull()
    .default('0'),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
