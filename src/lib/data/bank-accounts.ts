// Data layer for bank_accounts.

import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  bankAccounts,
  importedTransactions,
  type BankAccount,
  type NewBankAccount,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class BankAccountsNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Bank accounts require a configured database. Set DATABASE_URL and apply the banking-phase1 migration to use this module.',
    );
    this.name = 'BankAccountsNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new BankAccountsNotAvailableInDemoError();
  return getDb()!;
}

export async function listBankAccounts(
  companyId: string,
  options: { includeArchived?: boolean } = {},
): Promise<BankAccount[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const where = options.includeArchived
    ? eq(bankAccounts.companyId, companyId)
    : and(eq(bankAccounts.companyId, companyId), isNull(bankAccounts.archivedAt));
  return await db
    .select()
    .from(bankAccounts)
    .where(where)
    .orderBy(asc(bankAccounts.name));
}

/** Current register balance per account: opening balance + the signed sum
 *  of all non-ignored imported transactions. Map<bankAccountId, balance>.
 *  One grouped query — cheap enough for the banking hub's accounts list. */
export async function getCurrentBalancesByAccount(
  companyId: string,
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (!isDatabaseConfigured()) return balances;
  const db = getDb()!;
  const rows = await db
    .select({
      id: bankAccounts.id,
      opening: bankAccounts.openingBalance,
      txnSum: sql<string>`COALESCE(SUM(${importedTransactions.amount}), 0)`,
    })
    .from(bankAccounts)
    .leftJoin(
      importedTransactions,
      and(
        eq(importedTransactions.bankAccountId, bankAccounts.id),
        eq(importedTransactions.isIgnored, false),
      ),
    )
    .where(eq(bankAccounts.companyId, companyId))
    .groupBy(bankAccounts.id, bankAccounts.openingBalance);
  for (const r of rows) {
    balances.set(
      r.id,
      Math.round((Number(r.opening) + Number(r.txnSum)) * 100) / 100,
    );
  }
  return balances;
}

export async function getBankAccount(
  companyId: string,
  id: string,
): Promise<BankAccount | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, companyId)))
    .limit(1);
  return rows[0];
}

export async function createBankAccount(
  input: NewBankAccount,
): Promise<BankAccount> {
  const db = requireDb();
  const [row] = await db.insert(bankAccounts).values(input).returning();
  return row;
}

export async function updateBankAccount(
  companyId: string,
  id: string,
  patch: Partial<
    Pick<
      NewBankAccount,
      'name' | 'type' | 'last4' | 'currency' | 'openingBalance' | 'openingDate'
    >
  >,
): Promise<BankAccount | undefined> {
  const db = requireDb();
  const rows = await db
    .update(bankAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, companyId)))
    .returning();
  return rows[0];
}
