// Data layer for accounting_accounts (Phase 1 Chart of Accounts).
//
// DB-only — no mock-store fallback. The action layer throws a clear error
// when DATABASE_URL is unset (mirrors project-documents).

import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { accountingAccounts, type AccountingAccount } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class AccountingNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Accounting features require a configured database. Set DATABASE_URL and apply the banking-phase1 migration to use this module.',
    );
    this.name = 'AccountingNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new AccountingNotAvailableInDemoError();
  return getDb()!;
}

export async function listAccountingAccounts(
  companyId: string,
): Promise<AccountingAccount[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(accountingAccounts)
    .where(eq(accountingAccounts.companyId, companyId))
    .orderBy(asc(accountingAccounts.type), asc(accountingAccounts.name));
}

export async function getAccountingAccount(
  companyId: string,
  id: string,
): Promise<AccountingAccount | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(accountingAccounts)
    .where(
      and(
        eq(accountingAccounts.id, id),
        eq(accountingAccounts.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

void requireDb;
