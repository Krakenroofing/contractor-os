import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { proposals } from './proposals';
import { changeOrders } from './change-orders';
import { invoiceTemplates } from './invoice-templates';
import { costCodes } from './cost-codes';
import { inventoryItems } from './inventory-items';
import { accountingAccounts } from './accounting-accounts';
import {
  invoiceStatusEnum,
  invoiceBillingTypeEnum,
  paymentStatusEnum,
} from './_enums';

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    changeOrderId: uuid('change_order_id').references(() => changeOrders.id, {
      onDelete: 'set null',
    }),
    templateId: uuid('template_id').references(() => invoiceTemplates.id, {
      onDelete: 'set null',
    }),
    // Phase 2.x: revenue category (income-rollup accounting_account) so the
    // P&L can split revenue by service type. Per-invoice — the income side is
    // subtotal-driven and lump-sum draws carry no detailed lines.
    accountingAccountId: uuid('accounting_account_id').references(
      () => accountingAccounts.id,
      { onDelete: 'set null' },
    ),
    number: text('number').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    billingType: invoiceBillingTypeEnum('billing_type').notNull().default('progress'),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    retainagePercent: numeric('retainage_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    retainageAmount: numeric('retainage_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    retainageReleased: numeric('retainage_released', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    expectedRetainageReleaseDate: date('expected_retainage_release_date'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    amountPaid: numeric('amount_paid', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    termsOverride: text('terms_override'),
    // Phase 1: optional human-readable billing label for the Project
    // metadata block, e.g. "Billing #3 of 12" or "Final billing".
    billingLabel: text('billing_label'),
    // Phase 1: optional per-invoice PO override. Falls back to nothing
    // when null. Rendered in the Project metadata block.
    purchaseOrderNumber: text('purchase_order_number'),
    // Display-only "30% of contract" tagging for lump-sum / progress draws.
    // Doesn't drive any math — the operator enters the actual amount on the
    // line. Rendered in the project metadata block when set.
    percentOfContract: numeric('percent_of_contract', { precision: 6, scale: 3 }),
    // When true, this invoice's progress % bills against the REVISED contract
    // (original + approved COs) with prior billings combined across base + CO
    // tracks — instead of the default base-only track. Lets one draw cover the
    // change order. See progress.ts / invoice-payload.ts.
    billAgainstRevised: boolean('bill_against_revised').notNull().default(false),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('invoices_project_idx').on(t.projectId),
    // Non-unique: invoice numbers may repeat within a company (e.g. the
    // same number re-used across years). Kept as a plain index for
    // lookups/sort. See migration 2026-05-28_invoices_allow_duplicate_numbers.
    companyNumberIdx: index('invoices_company_number_idx').on(
      t.companyId,
      t.number,
    ),
  }),
);

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    costCodeId: uuid('cost_code_id').references(() => costCodes.id, {
      onDelete: 'set null',
    }),
    inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    unit: text('unit'),
    quantity: numeric('quantity', { precision: 14, scale: 4 })
      .notNull()
      .default('1'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    invoiceIdx: index('invoice_line_items_invoice_idx').on(t.invoiceId),
  }),
);

export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    paymentNumber: text('payment_number').notNull().default(''),
    paidDate: date('paid_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    method: text('method'),
    reference: text('reference'),
    bankAccount: text('bank_account'),
    status: paymentStatusEnum('status').notNull().default('received'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    invoiceIdx: index('invoice_payments_invoice_idx').on(t.invoiceId),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;
