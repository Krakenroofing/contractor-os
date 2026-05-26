// Data layer for the P&L (Income Statement) report — Accounting Phase 2.
//
// Income side: sum invoiced subtotal (net, ex-VAT) within the date range,
// for invoices not in 'draft' or 'void' status. Accrual basis. Invoices
// don't have an accountingAccountId today, so the income side is a single
// total (most contractor income is 1-2 accounts anyway).
//
// Expense side: sum job_cost_entries.amount within the date range, grouped
// by accountingAccountId → joined to accounting_accounts for name +
// rollup_group. Phase 2 migration backfilled accountingAccountId from
// receipt_lines.posted_job_cost_entry_id, and createJobCostEntry now
// propagates it on new posts.
//
// Net Income = Revenue − COGS − OpEx (asset/liability/equity/vat_tax
// excluded — those are balance-sheet items, not income-statement).

import 'server-only';
import { and, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';
import {
  accountingAccounts,
  invoices,
  jobCostEntries,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type RollupGroup =
  | 'income'
  | 'cogs'
  | 'opex'
  | 'asset'
  | 'liability'
  | 'equity'
  | 'vat_tax';

export type ProfitLossAccountRow = {
  accountId: string;
  accountName: string;
  rollupGroup: RollupGroup;
  amount: number;
  entryCount: number;
};

export type ProfitLossReport = {
  /** Range echoed back for the page header. */
  from: string | null;
  to: string | null;
  income: {
    total: number;
    invoiceCount: number;
  };
  cogs: {
    total: number;
    accounts: ProfitLossAccountRow[];
  };
  opex: {
    total: number;
    accounts: ProfitLossAccountRow[];
  };
  /** Job-cost entries with no accountingAccountId — surfaced separately so
   *  the operator can fix the source receipts to get accurate categorization. */
  uncategorized: {
    total: number;
    entryCount: number;
  };
  grossProfit: number;
  grossMarginPercent: number; // 0–100
  netIncome: number;
};

export type ProfitLossFilters = {
  /** YYYY-MM-DD inclusive lower bound, or empty for unbounded. */
  from: string;
  /** YYYY-MM-DD inclusive upper bound, or empty for unbounded. */
  to: string;
};

/**
 * Build a P&L report for the given date range. Returns zeroes everywhere
 * when DATABASE_URL is unset (demo mode) so the page can still render.
 */
export async function buildProfitLossReport(
  companyId: string,
  filters: ProfitLossFilters,
): Promise<ProfitLossReport> {
  const empty: ProfitLossReport = {
    from: filters.from || null,
    to: filters.to || null,
    income: { total: 0, invoiceCount: 0 },
    cogs: { total: 0, accounts: [] },
    opex: { total: 0, accounts: [] },
    uncategorized: { total: 0, entryCount: 0 },
    grossProfit: 0,
    grossMarginPercent: 0,
    netIncome: 0,
  };
  if (!isDatabaseConfigured()) return empty;
  const db = getDb()!;

  // ----- Income: sum invoice subtotal in range -----
  const incomeConds = [
    eq(invoices.companyId, companyId),
    ne(invoices.status, 'draft'),
    ne(invoices.status, 'void'),
  ];
  if (filters.from) incomeConds.push(gte(invoices.invoiceDate, filters.from));
  if (filters.to) incomeConds.push(lte(invoices.invoiceDate, filters.to));
  const incomeRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${invoices.subtotal}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(invoices)
    .where(and(...incomeConds));
  const incomeTotal = Number(incomeRows[0]?.total ?? '0');
  const incomeInvoiceCount = Number(incomeRows[0]?.count ?? 0);

  // ----- Expense side: grouped by accounting_account_id -----
  const costConds = [
    eq(jobCostEntries.companyId, companyId),
    sql`${jobCostEntries.deletedAt} IS NULL`,
    isNotNull(jobCostEntries.accountingAccountId),
  ];
  if (filters.from) costConds.push(gte(jobCostEntries.entryDate, filters.from));
  if (filters.to) costConds.push(lte(jobCostEntries.entryDate, filters.to));

  const categorizedRows = await db
    .select({
      accountId: jobCostEntries.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: sql<string>`COALESCE(SUM(${jobCostEntries.amount}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(jobCostEntries)
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, jobCostEntries.accountingAccountId),
    )
    .where(and(...costConds))
    .groupBy(
      jobCostEntries.accountingAccountId,
      accountingAccounts.name,
      accountingAccounts.rollupGroup,
    )
    .orderBy(accountingAccounts.name);

  const cogsAccounts: ProfitLossAccountRow[] = [];
  const opexAccounts: ProfitLossAccountRow[] = [];
  let cogsTotal = 0;
  let opexTotal = 0;

  for (const r of categorizedRows) {
    if (!r.accountId) continue;
    const amount = Number(r.total);
    const row: ProfitLossAccountRow = {
      accountId: r.accountId,
      accountName: r.accountName,
      rollupGroup: r.rollupGroup as RollupGroup,
      amount,
      entryCount: Number(r.count ?? 0),
    };
    if (row.rollupGroup === 'cogs') {
      cogsAccounts.push(row);
      cogsTotal += amount;
    } else if (row.rollupGroup === 'opex') {
      opexAccounts.push(row);
      opexTotal += amount;
    }
    // asset / liability / equity / vat_tax / income are balance-sheet (or
    // shouldn't appear here for cost entries); skip from P&L.
  }

  // ----- Uncategorized: job_cost_entries with no accountingAccountId -----
  // Surfaced separately so Chris can see what's missing classification.
  const uncatConds = [
    eq(jobCostEntries.companyId, companyId),
    sql`${jobCostEntries.deletedAt} IS NULL`,
    sql`${jobCostEntries.accountingAccountId} IS NULL`,
  ];
  if (filters.from) uncatConds.push(gte(jobCostEntries.entryDate, filters.from));
  if (filters.to) uncatConds.push(lte(jobCostEntries.entryDate, filters.to));
  const uncatRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${jobCostEntries.amount}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(jobCostEntries)
    .where(and(...uncatConds));
  const uncategorizedTotal = Number(uncatRows[0]?.total ?? '0');
  const uncategorizedCount = Number(uncatRows[0]?.count ?? 0);

  const grossProfit = incomeTotal - cogsTotal;
  const grossMarginPercent =
    incomeTotal > 0 ? Math.round((grossProfit / incomeTotal) * 1000) / 10 : 0;
  const netIncome = grossProfit - opexTotal;

  return {
    from: filters.from || null,
    to: filters.to || null,
    income: { total: incomeTotal, invoiceCount: incomeInvoiceCount },
    cogs: { total: cogsTotal, accounts: cogsAccounts },
    opex: { total: opexTotal, accounts: opexAccounts },
    uncategorized: {
      total: uncategorizedTotal,
      entryCount: uncategorizedCount,
    },
    grossProfit,
    grossMarginPercent,
    netIncome,
  };
}
