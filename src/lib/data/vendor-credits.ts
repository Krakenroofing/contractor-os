// Data layer for vendor credits + their applications against bills (receipts).

import 'server-only';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  accountingAccounts,
  vendorCredits,
  vendorCreditApplications,
  type VendorCredit,
  type VendorCreditApplication,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class VendorCreditsNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Vendor credits require a configured database. Set DATABASE_URL and apply the vendor_credits migration.',
    );
    this.name = 'VendorCreditsNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new VendorCreditsNotAvailableInDemoError();
  return getDb()!;
}

export type VendorCreditWithApplied = VendorCredit & {
  /** Sum applied to bills so far. Open remainder = amount − appliedTotal. */
  appliedTotal: number;
};

export async function listVendorCredits(
  companyId: string,
  filter: { vendorId?: string } = {},
): Promise<VendorCreditWithApplied[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds = [
    eq(vendorCredits.companyId, companyId),
    isNull(vendorCredits.deletedAt),
  ];
  if (filter.vendorId) conds.push(eq(vendorCredits.vendorId, filter.vendorId));
  const rows = await db
    .select({
      credit: vendorCredits,
      appliedTotal: sql<string>`COALESCE((SELECT SUM(a.amount) FROM ${vendorCreditApplications} a WHERE a.credit_id = ${vendorCredits.id}), 0)`,
    })
    .from(vendorCredits)
    .where(and(...conds))
    .orderBy(desc(vendorCredits.creditDate));
  return rows.map((r) => ({
    ...r.credit,
    appliedTotal: Number(r.appliedTotal),
  }));
}

export async function getVendorCredit(
  companyId: string,
  id: string,
): Promise<VendorCreditWithApplied | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select({
      credit: vendorCredits,
      appliedTotal: sql<string>`COALESCE((SELECT SUM(a.amount) FROM ${vendorCreditApplications} a WHERE a.credit_id = ${vendorCredits.id}), 0)`,
    })
    .from(vendorCredits)
    .where(
      and(
        eq(vendorCredits.id, id),
        eq(vendorCredits.companyId, companyId),
        isNull(vendorCredits.deletedAt),
      ),
    )
    .limit(1);
  const r = rows[0];
  return r ? { ...r.credit, appliedTotal: Number(r.appliedTotal) } : undefined;
}

export async function createVendorCredit(input: {
  companyId: string;
  vendorId: string;
  creditDate: string;
  amount: string;
  accountingAccountId: string;
  reference: string | null;
  notes: string | null;
  createdByUserId: string | null;
}): Promise<VendorCredit> {
  const db = requireDb();
  const [row] = await db.insert(vendorCredits).values(input).returning();
  return row;
}

export async function softDeleteVendorCredit(
  companyId: string,
  id: string,
): Promise<VendorCredit | undefined> {
  const db = requireDb();
  const rows = await db
    .update(vendorCredits)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(vendorCredits.id, id),
        eq(vendorCredits.companyId, companyId),
        isNull(vendorCredits.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

// ===== Applications =====

export async function listApplicationsForReceipts(
  companyId: string,
  receiptIds: string[],
): Promise<VendorCreditApplication[]> {
  if (!isDatabaseConfigured() || receiptIds.length === 0) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(vendorCreditApplications)
    .where(
      and(
        eq(vendorCreditApplications.companyId, companyId),
        inArray(vendorCreditApplications.receiptId, receiptIds),
      ),
    );
}

export async function getVendorCreditApplication(
  companyId: string,
  id: string,
): Promise<VendorCreditApplication | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(vendorCreditApplications)
    .where(
      and(
        eq(vendorCreditApplications.id, id),
        eq(vendorCreditApplications.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createVendorCreditApplication(input: {
  companyId: string;
  creditId: string;
  receiptId: string;
  amount: string;
}): Promise<VendorCreditApplication> {
  const db = requireDb();
  const [row] = await db
    .insert(vendorCreditApplications)
    .values(input)
    .returning();
  return row;
}

export async function deleteVendorCreditApplication(
  companyId: string,
  id: string,
): Promise<VendorCreditApplication | undefined> {
  const db = requireDb();
  const rows = await db
    .delete(vendorCreditApplications)
    .where(
      and(
        eq(vendorCreditApplications.id, id),
        eq(vendorCreditApplications.companyId, companyId),
      ),
    )
    .returning();
  return rows[0];
}

/** Applied-credit totals per receipt — the reconciliation matcher subtracts
 *  this from receipt totals so a bank payment of (bill − credit) matches. */
export async function sumAppliedCreditsByReceipt(
  companyId: string,
  receiptIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!isDatabaseConfigured() || receiptIds.length === 0) return map;
  const db = getDb()!;
  const rows = await db
    .select({
      receiptId: vendorCreditApplications.receiptId,
      total: sql<string>`COALESCE(SUM(${vendorCreditApplications.amount}), 0)`,
    })
    .from(vendorCreditApplications)
    .where(
      and(
        eq(vendorCreditApplications.companyId, companyId),
        inArray(vendorCreditApplications.receiptId, receiptIds),
      ),
    )
    .groupBy(vendorCreditApplications.receiptId);
  for (const r of rows) map.set(r.receiptId, Number(r.total));
  return map;
}

/** Vendor-credit totals by expense category in a date range — the P&L's
 *  contra-expense source (credits REDUCE the category). */
export async function sumVendorCreditsByAccount(
  companyId: string,
  filters: { from?: string; to?: string },
): Promise<
  Array<{
    accountingAccountId: string;
    accountName: string;
    rollupGroup: string;
    total: number;
    count: number;
  }>
> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds = [
    eq(vendorCredits.companyId, companyId),
    isNull(vendorCredits.deletedAt),
  ];
  if (filters.from) conds.push(gte(vendorCredits.creditDate, filters.from));
  if (filters.to) conds.push(lte(vendorCredits.creditDate, filters.to));
  const rows = await db
    .select({
      accountingAccountId: vendorCredits.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: sql<string>`COALESCE(SUM(${vendorCredits.amount}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(vendorCredits)
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, vendorCredits.accountingAccountId),
    )
    .where(and(...conds))
    .groupBy(
      vendorCredits.accountingAccountId,
      accountingAccounts.name,
      accountingAccounts.rollupGroup,
    );
  return rows.map((r) => ({
    accountingAccountId: r.accountingAccountId,
    accountName: r.accountName,
    rollupGroup: r.rollupGroup,
    total: Number(r.total),
    count: Number(r.count ?? 0),
  }));
}

/** The individual credits behind one category in range — P&L drill-down. */
export async function listVendorCreditsForAccount(
  companyId: string,
  accountingAccountId: string,
  filters: { from?: string; to?: string },
): Promise<VendorCredit[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds = [
    eq(vendorCredits.companyId, companyId),
    eq(vendorCredits.accountingAccountId, accountingAccountId),
    isNull(vendorCredits.deletedAt),
  ];
  if (filters.from) conds.push(gte(vendorCredits.creditDate, filters.from));
  if (filters.to) conds.push(lte(vendorCredits.creditDate, filters.to));
  return await db
    .select()
    .from(vendorCredits)
    .where(and(...conds))
    .orderBy(vendorCredits.creditDate);
}
