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

// Phase 2 receipts. Stays draft until the operator posts; posting writes a
// single row into job_cost_entries with source='receipt_import' and
// source_ref_id pointing at receipts.id. The 1:1 link is captured in
// posted_job_cost_entry_id so Unpost can find and remove it.
//
// Money: numeric(14, 2). Currency is stored on the receipt and inherited by
// the posted job_cost_entry (FX conversion is deferred).
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

    status: receiptStatusEnum('status').notNull().default('draft'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedJobCostEntryId: uuid('posted_job_cost_entry_id').references(
      () => jobCostEntries.id,
      { onDelete: 'set null' },
    ),

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
export type ReceiptAttachment = typeof receiptAttachments.$inferSelect;
export type NewReceiptAttachment = typeof receiptAttachments.$inferInsert;
