// Data layer for accounting_accounts (Phase 1 Chart of Accounts).
//
// DB-only — no mock-store fallback. The action layer throws a clear error
// when DATABASE_URL is unset (mirrors project-documents).

import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
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

// Section header for a rollup group (parent_id IS NULL). Custom categories
// hang off these. Returns undefined if the company hasn't installed the
// standard structure yet — the action layer creates one on demand.
export async function findSectionHeader(
  companyId: string,
  rollupGroup: AccountingAccount['rollupGroup'],
): Promise<AccountingAccount | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(accountingAccounts)
    .where(
      and(
        eq(accountingAccounts.companyId, companyId),
        eq(accountingAccounts.rollupGroup, rollupGroup),
        isNull(accountingAccounts.parentId),
      ),
    )
    .limit(1);
  return rows[0];
}

// Case-insensitive lookup of an active account by name within a rollup group —
// used to block duplicate category names.
export async function findActiveAccountByName(
  companyId: string,
  rollupGroup: AccountingAccount['rollupGroup'],
  name: string,
): Promise<AccountingAccount | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(accountingAccounts)
    .where(
      and(
        eq(accountingAccounts.companyId, companyId),
        eq(accountingAccounts.rollupGroup, rollupGroup),
        eq(accountingAccounts.isArchived, false),
        sql`lower(${accountingAccounts.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertAccountingAccount(
  companyId: string,
  input: {
    name: string;
    type: AccountingAccount['type'];
    rollupGroup: AccountingAccount['rollupGroup'];
    parentId: string | null;
  },
): Promise<AccountingAccount> {
  const db = requireDb();
  const [row] = await db
    .insert(accountingAccounts)
    .values({
      companyId,
      name: input.name,
      type: input.type,
      rollupGroup: input.rollupGroup,
      parentId: input.parentId,
    })
    .returning();
  return row;
}

export async function renameAccountingAccount(
  companyId: string,
  id: string,
  name: string,
): Promise<AccountingAccount | undefined> {
  const db = requireDb();
  const [row] = await db
    .update(accountingAccounts)
    .set({ name, updatedAt: new Date() })
    .where(
      and(
        eq(accountingAccounts.id, id),
        eq(accountingAccounts.companyId, companyId),
      ),
    )
    .returning();
  return row;
}

export async function setAccountingAccountArchived(
  companyId: string,
  id: string,
  archived: boolean,
): Promise<AccountingAccount | undefined> {
  const db = requireDb();
  const [row] = await db
    .update(accountingAccounts)
    .set({ isArchived: archived, updatedAt: new Date() })
    .where(
      and(
        eq(accountingAccounts.id, id),
        eq(accountingAccounts.companyId, companyId),
      ),
    )
    .returning();
  return row;
}
