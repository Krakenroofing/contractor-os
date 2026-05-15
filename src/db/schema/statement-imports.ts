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
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';
import { projects } from './projects';
import { costCodes } from './cost-codes';
import { bankAccounts } from './bank-accounts';
import { accountingAccounts } from './accounting-accounts';
import { statementImportStatusEnum } from './_enums';

// Saved column maps per (company, bank_account). bank_account_id IS NULL is
// a company-wide template. The mapping is preselected when importing for the
// referenced bank account.
export const bankStatementMappings = pgTable(
  'bank_statement_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, {
      onDelete: 'cascade',
    }),
    label: text('label').notNull(),
    // { date, desc, amount, debit, credit, reference, payee, memo } — every
    // entry maps a logical field → source column name.
    columnMap: jsonb('column_map').notNull(),
    // 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'M/D/YYYY' | 'D/M/YYYY'
    dateFormat: text('date_format').notNull().default('YYYY-MM-DD'),
    // 'signed_amount' | 'debit_credit_split'
    amountStrategy: text('amount_strategy').notNull().default('signed_amount'),
    decimalSeparator: text('decimal_separator').notNull().default('.'),
    thousandsSeparator: text('thousands_separator').notNull().default(','),
    skipRows: integer('skip_rows').notNull().default(0),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index('bank_statement_mappings_account_idx').on(t.bankAccountId),
    companyIdx: index('bank_statement_mappings_company_idx').on(t.companyId),
  }),
);

// One row per uploaded statement file.
export const statementImportBatches = pgTable(
  'statement_import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    mappingId: uuid('mapping_id').references(() => bankStatementMappings.id, {
      onDelete: 'set null',
    }),
    status: statementImportStatusEnum('status').notNull().default('pending'),
    sourceFilename: text('source_filename').notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    rowCount: integer('row_count').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    totalsDebit: numeric('totals_debit', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    totalsCredit: numeric('totals_credit', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    errorMessage: text('error_message'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    accountIdx: index('statement_import_batches_account_idx').on(t.bankAccountId),
    companyIdx: index('statement_import_batches_company_idx').on(t.companyId),
  }),
);

// Staging ledger. NO posting in Phase 1 — matching, reconciliation, and
// job-cost posting are deferred to later phases. Phase 1 supports manual
// categorization via the three nullable FK columns at the bottom.
//
// Money: numeric(14, 2) matches every other dollar column in the app. `amount`
// is signed (positive = money in, negative = money out) so a single column
// drives every downstream filter; `debit`/`credit` retain the raw split for
// audit only.
//
// Dedupe: UNIQUE(company_id, bank_account_id, dedupe_hash). Hash is computed
// in the import orchestrator at insert time. A repeat import inserts via
// ON CONFLICT DO NOTHING — duplicates are counted, never doubled.
export const importedTransactions = pgTable(
  'imported_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => statementImportBatches.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),

    transactionDate: date('transaction_date').notNull(),
    postedDate: date('posted_date'),
    description: text('description').notNull(),
    payee: text('payee'),
    memo: text('memo'),

    debit: numeric('debit', { precision: 14, scale: 2 }),
    credit: numeric('credit', { precision: 14, scale: 2 }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    reference: text('reference'),

    sourceFilename: text('source_filename').notNull(),
    dedupeHash: text('dedupe_hash').notNull(),

    isReviewed: boolean('is_reviewed').notNull().default(false),
    isIgnored: boolean('is_ignored').notNull().default(false),

    accountingAccountId: uuid('accounting_account_id').references(
      () => accountingAccounts.id,
      { onDelete: 'set null' },
    ),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    costCodeId: uuid('cost_code_id').references(() => costCodes.id, {
      onDelete: 'set null',
    }),

    notes: text('notes'),
    rawRow: jsonb('raw_row').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupeUniq: uniqueIndex('imported_transactions_dedupe_uniq').on(
      t.companyId,
      t.bankAccountId,
      t.dedupeHash,
    ),
    batchIdx: index('imported_transactions_batch_idx').on(t.batchId),
    accountDateIdx: index('imported_transactions_account_date_idx').on(
      t.bankAccountId,
      t.transactionDate,
    ),
  }),
);

export type BankStatementMapping = typeof bankStatementMappings.$inferSelect;
export type NewBankStatementMapping = typeof bankStatementMappings.$inferInsert;
export type StatementImportBatch = typeof statementImportBatches.$inferSelect;
export type NewStatementImportBatch = typeof statementImportBatches.$inferInsert;
export type ImportedTransaction = typeof importedTransactions.$inferSelect;
export type NewImportedTransaction = typeof importedTransactions.$inferInsert;
