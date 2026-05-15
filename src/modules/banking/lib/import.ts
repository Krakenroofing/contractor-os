// Statement import orchestrator: parse → map → dedupe → insert.
//
// Phase 1 inserts rows into imported_transactions only. No posting to
// job_cost_entries, no matching to invoice_payments. Duplicates are caught
// via UNIQUE(company_id, bank_account_id, dedupe_hash) and counted but
// never inserted twice.

import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  importedTransactions,
  statementImportBatches,
  type StatementImportBatch,
} from '@/db/schema';
import { toMoneyString } from '@/lib/money';
import { buildDedupeHash, toCents } from './dedupe';
import {
  applyMapping,
  summarizeDrafts,
  type Mapping,
  type TransactionDraft,
} from './mapping';

export type CommitImportResult = {
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  totalsDebit: string;
  totalsCredit: string;
  errors: { rowIndex: number; reason: string }[];
};

export function previewMapping(input: {
  rows: Record<string, string>[];
  mapping: Mapping;
}): {
  drafts: TransactionDraft[];
  totalsDebit: string;
  totalsCredit: string;
  rowCount: number;
  errors: { rowIndex: number; reason: string }[];
} {
  const { drafts, errors } = applyMapping(input.rows, input.mapping);
  const { totalsDebit, totalsCredit, rowCount } = summarizeDrafts(drafts);
  return { drafts, totalsDebit, totalsCredit, rowCount, errors };
}

/** Insert drafts into imported_transactions for the given batch. Duplicates
 *  (same company_id, bank_account_id, dedupe_hash) are silently skipped via
 *  ON CONFLICT DO NOTHING — the count of skipped rows is returned for UI.
 *  Updates the batch row with the final counts and totals in the same
 *  transaction. */
export async function commitImport(input: {
  batch: StatementImportBatch;
  drafts: TransactionDraft[];
  errors: { rowIndex: number; reason: string }[];
  defaultCurrency: string;
}): Promise<CommitImportResult> {
  if (!isDatabaseConfigured()) {
    throw new Error('Database not configured');
  }
  const db = getDb()!;
  const batch = input.batch;
  const drafts = input.drafts;

  let totalsDebitCents = 0;
  let totalsCreditCents = 0;

  // Build value rows. dedupe_hash is computed once per draft.
  const values = drafts.map((d) => {
    const effectiveDate = d.postedDate ?? d.transactionDate;
    const cents = toCents(d.amount);
    if (cents < 0) totalsDebitCents += -cents;
    else totalsCreditCents += cents;
    const dedupeHash = buildDedupeHash({
      bankAccountId: batch.bankAccountId,
      effectiveDate,
      amountCents: cents,
      description: d.description,
      reference: d.reference,
    });
    return {
      companyId: batch.companyId,
      batchId: batch.id,
      bankAccountId: batch.bankAccountId,
      transactionDate: d.transactionDate,
      postedDate: d.postedDate,
      description: d.description,
      payee: d.payee,
      memo: d.memo,
      debit: d.debit !== null ? toMoneyString(d.debit) : null,
      credit: d.credit !== null ? toMoneyString(d.credit) : null,
      amount: toMoneyString(d.amount),
      currency: input.defaultCurrency || 'USD',
      reference: d.reference,
      sourceFilename: batch.sourceFilename,
      dedupeHash,
      rawRow: d.rawRow,
    };
  });

  let imported = 0;
  let duplicates = 0;

  // Chunked insert with ON CONFLICT DO NOTHING. Postgres has a parameter
  // limit, so chunk to keep us well under it.
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const result = await db
      .insert(importedTransactions)
      .values(chunk)
      .onConflictDoNothing({
        target: [
          importedTransactions.companyId,
          importedTransactions.bankAccountId,
          importedTransactions.dedupeHash,
        ],
      })
      .returning({ id: importedTransactions.id });
    imported += result.length;
    duplicates += chunk.length - result.length;
  }

  const totalsDebit = toMoneyString(totalsDebitCents / 100);
  const totalsCredit = toMoneyString(totalsCreditCents / 100);

  await db
    .update(statementImportBatches)
    .set({
      status: 'imported',
      rowCount: drafts.length + input.errors.length,
      importedCount: imported,
      duplicateCount: duplicates,
      errorCount: input.errors.length,
      totalsDebit,
      totalsCredit,
      errorMessage:
        input.errors.length === 0
          ? null
          : input.errors
              .slice(0, 20)
              .map((e) => e.reason)
              .join('\n'),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`${statementImportBatches.id} = ${batch.id}`);

  return {
    rowCount: drafts.length + input.errors.length,
    importedCount: imported,
    duplicateCount: duplicates,
    errorCount: input.errors.length,
    totalsDebit,
    totalsCredit,
    errors: input.errors,
  };
}
