import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  integer,
  timestamp,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { accountingAccounts } from './accounting-accounts';
import { projects } from './projects';

// Phase 3: real double-entry general ledger.
//
// A journal_entry is one balanced transaction (sum of line debits == sum of
// line credits); journal_lines are its postings to chart-of-accounts accounts
// (accounting_accounts is the COA). Every financial event (invoice, payment,
// bank txn, receipt, manual adjustment, ...) ultimately becomes one balanced
// journal entry, so the Trial Balance / Balance Sheet tie out by construction.
//
// `source_type` + `source_id` link an auto-posted entry back to the event that
// produced it (so we can find/reverse "the entry for invoice X"). Reversals
// are themselves journal entries that mirror the original (debit<->credit),
// linked via reverses_entry_id / reversed_by_entry_id — we never delete posted
// entries.
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date').notNull(),
    memo: text('memo'),
    /** 'manual' | 'invoice' | 'payment' | 'bank' | 'receipt' | 'opening' | … */
    sourceType: text('source_type').notNull().default('manual'),
    /** The id of the source event (invoice id, payment id, …). Null for manual. */
    sourceId: uuid('source_id'),
    reversesEntryId: uuid('reverses_entry_id').references(
      (): AnyPgColumn => journalEntries.id,
      { onDelete: 'set null' },
    ),
    reversedByEntryId: uuid('reversed_by_entry_id').references(
      (): AnyPgColumn => journalEntries.id,
      { onDelete: 'set null' },
    ),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyDateIdx: index('journal_entries_company_date_idx').on(
      t.companyId,
      t.entryDate,
    ),
    sourceIdx: index('journal_entries_source_idx').on(
      t.companyId,
      t.sourceType,
      t.sourceId,
    ),
  }),
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accountingAccounts.id, { onDelete: 'restrict' }),
    // Exactly one of debit/credit is > 0 per line; the other is 0.
    debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0'),
    credit: numeric('credit', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    // Optional job dimension so the GL can also answer per-project questions.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    entryIdx: index('journal_lines_entry_idx').on(t.journalEntryId),
    companyAccountIdx: index('journal_lines_company_account_idx').on(
      t.companyId,
      t.accountId,
    ),
  }),
);

// Supporting documents on MANUAL journal entries — the working paper behind
// an adjustment ("how did I get this number a year later?"). Only manual
// entries carry attachments: system-posted entries are deleted + re-created
// by GL rebuilds (new ids), which would cascade-orphan any attachment.
export const journalEntryAttachments = pgTable(
  'journal_entry_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by'),
    originalFileName: text('original_file_name').notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    entryIdx: index('journal_entry_attachments_entry_idx').on(t.journalEntryId),
    companyIdx: index('journal_entry_attachments_company_idx').on(t.companyId),
  }),
);

export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type JournalLine = typeof journalLines.$inferSelect;
export type NewJournalLine = typeof journalLines.$inferInsert;
export type JournalEntryAttachment = typeof journalEntryAttachments.$inferSelect;
export type NewJournalEntryAttachment = typeof journalEntryAttachments.$inferInsert;
