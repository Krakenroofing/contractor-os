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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { vendors } from './vendors';
import { costCodes } from './cost-codes';
import { users } from './users';
import { bankAccounts } from './bank-accounts';
import { accountingAccounts } from './accounting-accounts';
import { jobCostEntries } from './job-costs';
import {
  receiptStatusEnum,
  paymentSourceTypeEnum,
  receiptAttachmentKindEnum,
} from './_enums';

// Receipts. Stays draft until the operator posts; posting writes one
// job_cost_entries row per receipt_lines row, all sharing
// source='receipt_import' and source_ref_id = receipts.id. The 1:1 link
// per line is captured in receipt_lines.posted_job_cost_entry_id.
//
// Money: numeric(14, 2). Currency is stored on the receipt and inherited by
// the posted job_cost_entry (FX conversion is deferred).
//
// Phase 2.1 (multi-line split): project_id, cost_code_id,
// accounting_account_id, cost_type, is_billable, is_reimbursable, and
// posted_job_cost_entry_id remain on the header for historical data but are
// deprecated — new code reads these from receipt_lines. receipts.subtotal /
// vat_amount / total are denormalized sums of line totals, kept in sync by
// the app on every line write.
export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    costCodeId: uuid('cost_code_id').references(() => costCodes.id, {
      onDelete: 'set null',
    }),
    vendorId: uuid('vendor_id').references(() => vendors.id, {
      onDelete: 'set null',
    }),
    accountingAccountId: uuid('accounting_account_id').references(
      () => accountingAccounts.id,
      { onDelete: 'set null' },
    ),

    paymentSourceType: paymentSourceTypeEnum('payment_source_type')
      .notNull()
      .default('cash'),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, {
      onDelete: 'set null',
    }),
    // How this expense was paid (Wire / Zelle / company card / …) — a
    // user-managed list; FK constraint lives in the SQL migration.
    paymentMethodId: uuid('payment_method_id'),

    receiptDate: date('receipt_date').notNull(),
    currency: text('currency').notNull().default('USD'),

    subtotal: numeric('subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    total: numeric('total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    vatRatePercent: numeric('vat_rate_percent', { precision: 6, scale: 3 }),
    vatIncluded: boolean('vat_included').notNull().default(true),
    vatRecoverable: boolean('vat_recoverable').notNull().default(true),
    vatPeriodQuarter: text('vat_period_quarter'),
    vendorTin: text('vendor_tin'),

    // Free-form override matching the existing job_cost_type enum at the app
    // layer. Stored as text so we don't FK against a real enum here — the
    // Phase 1 receipts data layer validates against the enum's values.
    costType: text('cost_type'),

    // The SUPPLIER's invoice number — typed to match their paperwork so
    // outstanding bills tie to vendor statements. Optional on ad-hoc
    // receipts; the PO→bill flow requires it.
    vendorInvoiceNumber: text('vendor_invoice_number'),
    // Set when this bill was created from a purchase order (PO→bill flow).
    // FK declared without reference to avoid a circular import; constraint
    // lives in the SQL migration (ON DELETE SET NULL).
    purchaseOrderId: uuid('purchase_order_id'),

    status: receiptStatusEnum('status').notNull().default('draft'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedJobCostEntryId: uuid('posted_job_cost_entry_id').references(
      () => jobCostEntries.id,
      { onDelete: 'set null' },
    ),

    // Phase 2.2 approval audit. submitted_* set on draft → submitted.
    // approved_* set on submitted/draft → posted. rejection_reason captures
    // the optional note an approver writes when bouncing back to draft.
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    rejectionReason: text('rejection_reason'),

    isBillable: boolean('is_billable').notNull().default(false),
    isReimbursable: boolean('is_reimbursable').notNull().default(false),
    notes: text('notes'),

    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index('receipts_company_idx').on(t.companyId),
    projectIdx: index('receipts_project_idx').on(t.projectId),
    statusIdx: index('receipts_status_idx').on(t.companyId, t.status),
    postedJceIdx: index('receipts_posted_jce_idx').on(t.postedJobCostEntryId),
  }),
);

// Phase 2.1: one row per cost-code-split of a single receipt. A simple
// receipt has exactly one line; a Home Depot run for two projects has two.
// posted_job_cost_entry_id is the 1:1 link to the job_cost_entries row
// written by Post; Unpost soft-deletes it and clears this column.
export const receiptLines = pgTable(
  'receipt_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),

    sortOrder: integer('sort_order').notNull().default(0),

    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    costCodeId: uuid('cost_code_id').references(() => costCodes.id, {
      onDelete: 'set null',
    }),
    accountingAccountId: uuid('accounting_account_id').references(
      () => accountingAccounts.id,
      { onDelete: 'set null' },
    ),

    // Free-form override matching the job_cost_type enum at the app layer
    // (validated by the receipts data layer).
    costType: text('cost_type'),
    description: text('description'),

    // The PO line this bill line invoices (PO→bill flow) — lets the PO show
    // how much of each line has been billed. FK constraint in the SQL
    // migration (ON DELETE SET NULL).
    purchaseOrderLineId: uuid('purchase_order_line_id'),

    subtotal: numeric('subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    total: numeric('total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    // Per-line VAT rate override. Null = inherit the receipt header's rate.
    vatRatePercent: numeric('vat_rate_percent', { precision: 6, scale: 3 }),

    isBillable: boolean('is_billable').notNull().default(false),
    isReimbursable: boolean('is_reimbursable').notNull().default(false),

    // Phase 2.4 reimbursable flow. paid_by_user_id captures who's owed money
    // when is_reimbursable=true. reimbursementPayoutId is the FK to the
    // payout that settled this line (null = unpaid). The pair lets the
    // /banking/reimbursements page list pending lines and group by payee.
    paidByUserId: uuid('paid_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reimbursementPayoutId: uuid('reimbursement_payout_id').references(
      (): AnyPgColumn => receiptReimbursementPayouts.id,
      { onDelete: 'set null' },
    ),

    postedJobCostEntryId: uuid('posted_job_cost_entry_id').references(
      () => jobCostEntries.id,
      { onDelete: 'set null' },
    ),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    receiptIdx: index('receipt_lines_receipt_idx').on(t.receiptId),
    companyIdx: index('receipt_lines_company_idx').on(t.companyId),
    projectIdx: index('receipt_lines_project_idx').on(t.projectId),
    postedJceIdx: index('receipt_lines_posted_jce_idx').on(
      t.postedJobCostEntryId,
    ),
    pendingReimbursementIdx: index('receipt_lines_pending_reimbursement_idx').on(
      t.companyId,
      t.paidByUserId,
    ),
  }),
);

// Phase 2.4 reimbursable flow. One row = one cash-out to a person (check,
// ACH, cash, etc.) covering one or more reimbursable receipt_lines.
// Line→payout link is on receipt_lines.reimbursementPayoutId; this table
// just records what / when / how the payout happened.
export const receiptReimbursementPayouts = pgTable(
  'receipt_reimbursement_payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    paidToUserId: uuid('paid_to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    paidAt: date('paid_at').notNull(),
    paidVia: text('paid_via').notNull(),
    reference: text('reference'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index('receipt_reimbursement_payouts_company_idx').on(t.companyId),
    userIdx: index('receipt_reimbursement_payouts_user_idx').on(
      t.companyId,
      t.paidToUserId,
      t.paidAt,
    ),
  }),
);

export const receiptAttachments = pgTable(
  'receipt_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),

    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    originalFilename: text('original_filename').notNull(),
    kind: receiptAttachmentKindEnum('kind').notNull().default('receipt_image'),

    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    receiptIdx: index('receipt_attachments_receipt_idx').on(t.receiptId),
    companyIdx: index('receipt_attachments_company_idx').on(t.companyId),
  }),
);

export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type ReceiptLine = typeof receiptLines.$inferSelect;
export type NewReceiptLine = typeof receiptLines.$inferInsert;
export type ReceiptAttachment = typeof receiptAttachments.$inferSelect;
export type NewReceiptAttachment = typeof receiptAttachments.$inferInsert;
export type ReceiptReimbursementPayout =
  typeof receiptReimbursementPayouts.$inferSelect;
export type NewReceiptReimbursementPayout =
  typeof receiptReimbursementPayouts.$inferInsert;
