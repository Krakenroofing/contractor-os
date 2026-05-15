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
  type BankStatementMapping,
  type NewBankStatementMapping,
  type StatementImportBatch,
  type NewStatementImportBatch,
  type ImportedTransaction,
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

// ===== Imported transactions =====

export type ListImportedTransactionsFilters = {
  bankAccountId?: string;
  batchId?: string;
  fromDate?: string; // ISO YYYY-MM-DD
  toDate?: string;
  search?: string;
  includeIgnored?: boolean;
  onlyUnreviewed?: boolean;
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
  if (filters.fromDate) {
    conds.push(gte(importedTransactions.transactionDate, filters.fromDate));
  }
  if (filters.toDate) {
    conds.push(lte(importedTransactions.transactionDate, filters.toDate));
  }
  if (filters.search && filters.search.trim() !== '') {
    const q = `%${filters.search.trim()}%`;
    const searchExpr = or(
      ilike(importedTransactions.description, q),
      ilike(importedTransactions.payee, q),
      ilike(importedTransactions.memo, q),
      ilike(importedTransactions.reference, q),
    );
    if (searchExpr) conds.push(searchExpr);
  }
  if (!filters.includeIgnored) {
    conds.push(eq(importedTransactions.isIgnored, false));
  }
  if (filters.onlyUnreviewed) {
    conds.push(eq(importedTransactions.isReviewed, false));
  }
  if (filters.onlyUncategorized) {
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
    .limit(filters.limit ?? 500)
    .offset(filters.offset ?? 0);
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
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(importedTransactions)
    .where(and(...conds));
  return rows[0]?.n ?? 0;
}

export type UpdateImportedTransactionPatch = Partial<
  Pick<
    ImportedTransaction,
    | 'accountingAccountId'
    | 'projectId'
    | 'costCodeId'
    | 'isReviewed'
    | 'isIgnored'
    | 'notes'
    | 'payee'
    | 'memo'
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

void asc;
void isNotNull;
