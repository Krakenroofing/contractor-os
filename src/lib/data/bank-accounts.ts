// Data layer for bank_accounts.

import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { bankAccounts, type BankAccount, type NewBankAccount } from '@/db/schema';
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
