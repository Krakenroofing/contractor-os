// Data layer for statement imports: batches, mappings, and the imported
// transactions ledger.

import 'server-only';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  bankStatementMappings,
  statementImportBatches,
  importedTransactions,
  importedTransactionLines,
  accountingAccounts,
  type BankStatementMapping,
  type NewBankStatementMapping,
  type StatementImportBatch,
  type NewStatementImportBatch,
  type ImportedTransaction,
  type ImportedTransactionLine,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class StatementImportsNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Statement imports require a configured database. Set DATABASE_URL and apply the banking-phase1 migration to use this module.',
    );
    this.name = 'StatementImportsNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new StatementImportsNotAvailableInDemoError();
  }
  return getDb()!;
}

/**
 * Statement-style running balance per transaction for one account:
 * opening balance + cumulative signed amount in bank order
 * (transaction_date, created_at, id — deterministic within a day).
 * Ignored rows are excluded from the ledger, exactly like every other
 * balance surface. Filter-independent: each row's balance reflects the FULL
 * ledger up to that row, so it stays correct on a filtered register view.
 */
export async function getRunningBalancesForAccount(
  companyId: string,
  bankAccountId: string,
  openingBalance: number,
): Promise<Map<string, number>> {
  if (!isDatabaseConfigured()) return new Map();
  const db = getDb()!;
  const rows = await db.execute<{ id: string; cum: string }>(sql`
    SELECT ${importedTransactions.id} AS id,
           SUM(${importedTransactions.amount}) OVER (
             ORDER BY ${importedTransactions.transactionDate},
                      ${importedTransactions.createdAt},
                      ${importedTransactions.id}
           ) AS cum
    FROM ${importedTransactions}
    WHERE ${importedTransactions.companyId} = ${companyId}
      AND ${importedTransactions.bankAccountId} = ${bankAccountId}
      AND ${importedTransactions.isIgnored} = false
  `);
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.id, Math.round((openingBalance + Number(r.cum)) * 100) / 100);
  }
  return map;
}

// ===== Mappings =====

export async function listMappingsForAccount(
  companyId: string,
  bankAccountId: string,
): Promise<BankStatementMapping[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(bankStatementMappings)
    .where(
      and(
        eq(bankStatementMappings.companyId, companyId),
        or(
          eq(bankStatementMappings.bankAccountId, bankAccountId),
          isNull(bankStatementMappings.bankAccountId),
        ),
      ),
    )
    .orderBy(desc(bankStatementMappings.updatedAt));
}

export async function getMapping(
  companyId: string,
  id: string,
): Promise<BankStatementMapping | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(bankStatementMappings)
    .where(
      and(
        eq(bankStatementMappings.id, id),
        eq(bankStatementMappings.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function upsertMapping(
  input: NewBankStatementMapping & { id?: string },
): Promise<BankStatementMapping> {
  const db = requireDb();
  if (input.id) {
    const [row] = await db
      .update(bankStatementMappings)
      .set({
        label: input.label,
        columnMap: input.columnMap,
        dateFormat: input.dateFormat,
        amountStrategy: input.amountStrategy,
        decimalSeparator: input.decimalSeparator,
        thousandsSeparator: input.thousandsSeparator,
        skipRows: input.skipRows,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bankStatementMappings.id, input.id),
          eq(bankStatementMappings.companyId, input.companyId),
        ),
      )
      .returning();
    return row;
  }
  const [row] = await db.insert(bankStatementMappings).values(input).returning();
  return row;
}

// ===== Batches =====

export async function listImportBatches(
  companyId: string,
  options: { bankAccountId?: string; limit?: number } = {},
): Promise<StatementImportBatch[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const where = options.bankAccountId
    ? and(
        eq(statementImportBatches.companyId, companyId),
        eq(statementImportBatches.bankAccountId, options.bankAccountId),
      )
    : eq(statementImportBatches.companyId, companyId);
  const rows = await db
    .select()
    .from(statementImportBatches)
    .where(where)
    .orderBy(desc(statementImportBatches.createdAt))
    .limit(options.limit ?? 50);
  return rows;
}

export async function getImportBatch(
  companyId: string,
  id: string,
): Promise<StatementImportBatch | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(statementImportBatches)
    .where(
      and(
        eq(statementImportBatches.id, id),
        eq(statementImportBatches.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createImportBatch(
  input: NewStatementImportBatch,
): Promise<StatementImportBatch> {
  const db = requireDb();
  const [row] = await db
    .insert(statementImportBatches)
    .values(input)
    .returning();
  return row;
}

export async function updateImportBatch(
  companyId: string,
  id: string,
  patch: Partial<NewStatementImportBatch>,
): Promise<StatementImportBatch | undefined> {
  const db = requireDb();
  const [row] = await db
    .update(statementImportBatches)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(statementImportBatches.id, id),
        eq(statementImportBatches.companyId, companyId),
      ),
    )
    .returning();
  return row;
}

/**
 * Hard-delete an import batch and everything that hangs off it. Relies on
 * the FK cascade: imported_transactions.batchId → cascade → transaction
 * matches on those transactions → cascade. Matched invoices/receipts/job
 * cost entries themselves are NOT touched; only the match link is severed,
 * so the target record reverts to "unmatched" naturally.
 *
 * Returns the deleted batch row (so the caller can revalidate the right
 * account page) or undefined if the batch wasn't found in this company.
 */
export async function deleteImportBatch(
  companyId: string,
  id: string,
): Promise<StatementImportBatch | undefined> {
  const db = requireDb();
  const [row] = await db
    .delete(statementImportBatches)
    .where(
      and(
        eq(statementImportBatches.id, id),
        eq(statementImportBatches.companyId, companyId),
      ),
    )
    .returning();
  return row;
}

// ===== Imported transactions =====

export type ListImportedTransactionsFilters = {
  bankAccountId?: string;
  batchId?: string;
  vendorId?: string;
  fromDate?: string; // ISO YYYY-MM-DD
  toDate?: string;
  search?: string;
  includeIgnored?: boolean;
  onlyUnreviewed?: boolean;
  onlyReviewed?: boolean;
  onlyUncategorized?: boolean;
  limit?: number;
  offset?: number;
};

export async function listImportedTransactions(
  companyId: string,
  filters: ListImportedTransactionsFilters = {},
): Promise<ImportedTransaction[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds: SQL[] = [eq(importedTransactions.companyId, companyId)];
  if (filters.bankAccountId) {
    conds.push(eq(importedTransactions.bankAccountId, filters.bankAccountId));
  }
  if (filters.batchId) {
    conds.push(eq(importedTransactions.batchId, filters.batchId));
  }
  if (filters.vendorId) {
    conds.push(eq(importedTransactions.vendorId, filters.vendorId));
  }
  if (filters.fromDate) {
    conds.push(gte(importedTransactions.transactionDate, filters.fromDate));
  }
  if (filters.toDate) {
    conds.push(lte(importedTransactions.transactionDate, filters.toDate));
  }
  if (filters.search && filters.search.trim() !== '') {
    const term = filters.search.trim();
    const q = `%${term}%`;
    const exprs: SQL[] = [
      ilike(importedTransactions.description, q),
      ilike(importedTransactions.payee, q),
      ilike(importedTransactions.memo, q),
      ilike(importedTransactions.reference, q),
    ];
    // Also match the dollar amount, so "122," or "$1,770.52" find the value —
    // strip thousands separators / currency from the term, then match against
    // the unsigned amount text (debits are stored negative).
    const numeric = term.replace(/[^0-9.]/g, '');
    if (/[0-9]/.test(numeric)) {
      exprs.push(
        sql`abs(${importedTransactions.amount})::text ilike ${`%${numeric}%`}`,
      );
    }
    const searchExpr = or(...exprs);
    if (searchExpr) conds.push(searchExpr);
  }
  if (!filters.includeIgnored) {
    conds.push(eq(importedTransactions.isIgnored, false));
  }
  if (filters.onlyUnreviewed) {
    conds.push(eq(importedTransactions.isReviewed, false));
  }
  if (filters.onlyReviewed) {
    conds.push(eq(importedTransactions.isReviewed, true));
  }
  if (filters.onlyUncategorized) {
    // A SPLIT transaction is categorized through its lines while the
    // txn-level category stays NULL — it must not count as uncategorized.
    conds.push(isNull(importedTransactions.accountingAccountId));
    conds.push(
      sql`NOT EXISTS (SELECT 1 FROM ${importedTransactionLines} l
        WHERE l.imported_transaction_id = ${importedTransactions.id})`,
    );
  }
  return await db
    .select()
    .from(importedTransactions)
    .where(and(...conds))
    .orderBy(
      desc(importedTransactions.transactionDate),
      desc(importedTransactions.createdAt),
    )
    .limit(filters.limit ?? 500)
    .offset(filters.offset ?? 0);
}

export type InputVatBankLine = {
  transactionId: string;
  date: string;
  amount: number;
  vendorId: string | null;
  description: string | null;
  accountName: string;
};

/**
 * Recoverable input VAT recorded by SPLITTING a bank transaction's VAT portion
 * onto a vat_input account (e.g. "Vat Receivable") — the operator's main way of
 * capturing input VAT, separate from posted receipts. One row per split line on
 * a vat_input account, dated by the transaction. Ignored transactions excluded.
 */
export async function listInputVatBankLines(
  companyId: string,
): Promise<InputVatBankLine[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select({
      transactionId: importedTransactions.id,
      date: importedTransactions.transactionDate,
      amount: importedTransactionLines.amount,
      vendorId: importedTransactions.vendorId,
      description: importedTransactions.description,
      accountName: accountingAccounts.name,
    })
    .from(importedTransactionLines)
    .innerJoin(
      importedTransactions,
      eq(importedTransactions.id, importedTransactionLines.importedTransactionId),
    )
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, importedTransactionLines.accountingAccountId),
    )
    .where(
      and(
        eq(importedTransactionLines.companyId, companyId),
        eq(accountingAccounts.type, 'vat_input'),
        eq(importedTransactions.isIgnored, false),
      ),
    );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function countImportedTransactions(
  companyId: string,
  filters: ListImportedTransactionsFilters = {},
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const conds: SQL[] = [eq(importedTransactions.companyId, companyId)];
  if (filters.bankAccountId) {
    conds.push(eq(importedTransactions.bankAccountId, filters.bankAccountId));
  }
  if (!filters.includeIgnored) {
    conds.push(eq(importedTransactions.isIgnored, false));
  }
  if (filters.onlyUnreviewed) {
    conds.push(eq(importedTransactions.isReviewed, false));
  }
  if (filters.onlyReviewed) {
    conds.push(eq(importedTransactions.isReviewed, true));
  }
  if (filters.onlyUncategorized) {
    // A SPLIT transaction is categorized through its lines while the
    // txn-level category stays NULL — it must not count as uncategorized.
    conds.push(isNull(importedTransactions.accountingAccountId));
    conds.push(
      sql`NOT EXISTS (SELECT 1 FROM ${importedTransactionLines} l
        WHERE l.imported_transaction_id = ${importedTransactions.id})`,
    );
  }
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(importedTransactions)
    .where(and(...conds));
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Job-cost actuals from categorized bank transactions. An expense charged
// directly on the bank statement (project-tagged + categorized) is real
// project spend, so job costing must see it. Excludes reconciled rows (those
// are matched to a receipt / job-cost entry already counted elsewhere) and
// ignored rows; counts debits only (amount < 0) as -amount. Mirrors the P&L
// bank-expense filter, and since the P&L and the job-cost report are separate
// surfaces there is no double-count between them.
// ---------------------------------------------------------------------------

function bankActualConds(companyId: string, projectId: string): SQL[] {
  return [
    eq(importedTransactions.companyId, companyId),
    eq(importedTransactions.projectId, projectId),
    eq(importedTransactions.isIgnored, false),
    isNull(importedTransactions.reconciledAt),
    isNotNull(importedTransactions.accountingAccountId),
    sql`${importedTransactions.amount} < 0`,
  ];
}

export async function sumBankActualForProject(
  companyId: string,
  projectId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(-${importedTransactions.amount}), 0)`,
    })
    .from(importedTransactions)
    .where(and(...bankActualConds(companyId, projectId)));
  return Number(rows[0]?.total ?? '0');
}

export async function sumBankActualByCostCodeForProject(
  companyId: string,
  projectId: string,
): Promise<Array<{ costCodeId: string; actual: number }>> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select({
      costCodeId: importedTransactions.costCodeId,
      total: sql<string>`COALESCE(SUM(-${importedTransactions.amount}), 0)`,
    })
    .from(importedTransactions)
    .where(
      and(
        ...bankActualConds(companyId, projectId),
        isNotNull(importedTransactions.costCodeId),
      ),
    )
    .groupBy(importedTransactions.costCodeId);
  return rows
    .filter((r): r is { costCodeId: string; total: string } => !!r.costCodeId)
    .map((r) => ({ costCodeId: r.costCodeId, actual: Number(r.total) }));
}

export async function getImportedTransaction(
  companyId: string,
  id: string,
): Promise<ImportedTransaction | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(importedTransactions)
    .where(
      and(
        eq(importedTransactions.id, id),
        eq(importedTransactions.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Batch-fetch the signed amount of many transactions by id. Used by deposit
 * reconciliation to know how much actual bank money backs a matched payment
 * (a payment matched whole to a smaller deposit only reconciles the deposit
 * amount — the rest stays unreconciled). Returns Map<id, amount>.
 */
export async function getImportedTransactionAmounts(
  companyId: string,
  ids: string[],
): Promise<Map<string, number>> {
  if (!isDatabaseConfigured() || ids.length === 0) return new Map();
  const db = getDb()!;
  const rows = await db
    .select({ id: importedTransactions.id, amount: importedTransactions.amount })
    .from(importedTransactions)
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        inArray(importedTransactions.id, ids),
      ),
    );
  return new Map(rows.map((r) => [r.id, Number(r.amount)]));
}

/** Pull the most recent N transactions for a company. Used by Rules Phase 2
 *  preview + bulk apply — both run the matcher in TS against this list rather
 *  than building SQL for every rule shape.
 *
 *  `onlyTriagable=true` filters to rows that Apply would actually touch:
 *  not reviewed, not ignored, no category yet. Keeps the bulk-apply preview
 *  honest. */
export async function listRecentTransactionsForRules(
  companyId: string,
  options: { limit?: number; onlyTriagable?: boolean } = {},
): Promise<ImportedTransaction[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds: SQL[] = [eq(importedTransactions.companyId, companyId)];
  if (options.onlyTriagable) {
    conds.push(eq(importedTransactions.isReviewed, false));
    conds.push(eq(importedTransactions.isIgnored, false));
    conds.push(isNull(importedTransactions.accountingAccountId));
  }
  return await db
    .select()
    .from(importedTransactions)
    .where(and(...conds))
    .orderBy(
      desc(importedTransactions.transactionDate),
      desc(importedTransactions.createdAt),
    )
    .limit(options.limit ?? 500);
}

export type UpdateImportedTransactionPatch = Partial<
  Pick<
    ImportedTransaction,
    | 'accountingAccountId'
    | 'projectId'
    | 'costCodeId'
    | 'vendorId'
    | 'paymentMethodId'
    | 'isReviewed'
    | 'isIgnored'
    | 'notes'
    | 'payee'
    | 'memo'
    | 'appliedRuleId'
    | 'appliedRuleAt'
  >
>;

export async function updateImportedTransaction(
  companyId: string,
  id: string,
  patch: UpdateImportedTransactionPatch,
): Promise<ImportedTransaction | undefined> {
  const db = requireDb();
  const [row] = await db
    .update(importedTransactions)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(importedTransactions.id, id),
        eq(importedTransactions.companyId, companyId),
      ),
    )
    .returning();
  return row;
}

// ===== Split lines =====

export type ImportedTransactionLineInput = {
  accountingAccountId: string | null;
  projectId: string | null;
  costCodeId: string | null;
  description: string | null;
  amount: string; // numeric string, positive magnitude
};

/** Lines for a set of transactions, batched. Returns [] in demo mode (the
 *  imported_transactions ledger is DB-only). Ordered by sort_order. */
export async function listLinesForTransactionIds(
  companyId: string,
  ids: string[],
): Promise<ImportedTransactionLine[]> {
  if (ids.length === 0 || !isDatabaseConfigured()) return [];
  const db = requireDb();
  return await db
    .select()
    .from(importedTransactionLines)
    .where(
      and(
        eq(importedTransactionLines.companyId, companyId),
        inArray(importedTransactionLines.importedTransactionId, ids),
      ),
    )
    .orderBy(asc(importedTransactionLines.sortOrder));
}

/** Replace the split lines for one transaction atomically. Passing an empty
 *  array clears the split (the transaction reverts to single-category). */
export async function replaceImportedTransactionLines(
  companyId: string,
  transactionId: string,
  lines: ImportedTransactionLineInput[],
): Promise<void> {
  const db = requireDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(importedTransactionLines)
      .where(
        and(
          eq(importedTransactionLines.companyId, companyId),
          eq(importedTransactionLines.importedTransactionId, transactionId),
        ),
      );
    if (lines.length > 0) {
      await tx.insert(importedTransactionLines).values(
        lines.map((l, i) => ({
          companyId,
          importedTransactionId: transactionId,
          sortOrder: i,
          accountingAccountId: l.accountingAccountId,
          projectId: l.projectId,
          costCodeId: l.costCodeId,
          description: l.description,
          amount: l.amount,
        })),
      );
    }
  });
}

/** Bulk-apply a rule's actions to a set of transactions inside one
 *  transaction. Returns the count of rows actually updated. Caller is
 *  responsible for pre-filtering to triagable rows (the SQL guards are a
 *  safety net, not the primary filter). */
export async function bulkApplyRuleToTransactions(
  companyId: string,
  ruleId: string,
  ids: string[],
  patch: UpdateImportedTransactionPatch,
): Promise<number> {
  if (ids.length === 0) return 0;
  const db = requireDb();
  return await db.transaction(async (tx) => {
    let touched = 0;
    for (const id of ids) {
      const [row] = await tx
        .update(importedTransactions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(importedTransactions.id, id),
            eq(importedTransactions.companyId, companyId),
            // Defence-in-depth: SQL refuses to touch a row that turned
            // reviewed/categorized between snapshot and apply.
            eq(importedTransactions.isReviewed, false),
            eq(importedTransactions.isIgnored, false),
            isNull(importedTransactions.accountingAccountId),
          ),
        )
        .returning({ id: importedTransactions.id });
      if (row) touched++;
    }
    // void parameter use — keeps ruleId in the function signature for future
    // audit-table writes (Phase 3 transaction_rule_matches).
    void ruleId;
    return touched;
  });
}

/**
 * Manual bulk categorize — stamp the provided fields onto the selected
 * transactions in one UPDATE. Unlike bulkApplyRuleToTransactions this does NOT
 * apply the rule "never overwrite" guard (the operator explicitly picked these
 * rows, and may be re-categorizing), but it DOES:
 *   - skip ignored rows, and
 *   - skip split rows (NOT EXISTS lines) — their per-line categories are the
 *     source of truth, so the parent fields must stay null.
 * Only fields present in `patch` are written. Returns the count updated.
 */
export async function bulkCategorizeTransactions(
  companyId: string,
  ids: string[],
  patch: {
    accountingAccountId?: string | null;
    projectId?: string | null;
    costCodeId?: string | null;
    vendorId?: string | null;
  },
  markReviewed: boolean,
): Promise<number> {
  if (ids.length === 0) return 0;
  const db = requireDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.accountingAccountId !== undefined)
    set.accountingAccountId = patch.accountingAccountId;
  if (patch.projectId !== undefined) set.projectId = patch.projectId;
  if (patch.costCodeId !== undefined) set.costCodeId = patch.costCodeId;
  if (patch.vendorId !== undefined) set.vendorId = patch.vendorId;
  if (markReviewed) {
    // Only mark reviewed rows that end up categorized — either a category is
    // being applied now, or the row already has one. Uncategorized rows stay
    // un-reviewed (they belong in the Accounting To-Do, not the books).
    const applyingCategory =
      patch.accountingAccountId != null && patch.accountingAccountId !== '';
    set.isReviewed = applyingCategory
      ? true
      : sql`CASE WHEN ${importedTransactions.accountingAccountId} IS NOT NULL THEN true ELSE ${importedTransactions.isReviewed} END`;
  }

  const rows = await db
    .update(importedTransactions)
    .set(set)
    .where(
      and(
        eq(importedTransactions.companyId, companyId),
        inArray(importedTransactions.id, ids),
        eq(importedTransactions.isIgnored, false),
        sql`NOT EXISTS (SELECT 1 FROM ${importedTransactionLines} l WHERE l.imported_transaction_id = ${importedTransactions.id})`,
      ),
    )
    .returning({ id: importedTransactions.id });
  return rows.length;
}

void asc;
void isNotNull;
