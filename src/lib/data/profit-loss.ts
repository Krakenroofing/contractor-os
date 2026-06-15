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
import { and, eq, gte, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  accountingAccounts,
  importedTransactions,
  invoices,
  jobCostEntries,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { buildWipReport } from '@/modules/reports/lib/wip';

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
    /** Revenue split by income category (invoices carrying a revenue
     *  category). Empty until invoices are categorized. */
    accounts: ProfitLossAccountRow[];
    /** Invoices with no revenue category — shown as one "Uncategorized
     *  revenue" line so the income still ties to the total. */
    uncategorized: { total: number; invoiceCount: number };
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
  /** Cumulative work-in-progress revenue-recognition position as of `asOf`.
   *  NOT period-bounded — earned revenue is % complete to date — so it sits
   *  as a separate "as of today" reconciliation under the period income
   *  statement, showing earned vs billed and the resulting balance-sheet
   *  position (contract asset when under-billed, deferred revenue when over). */
  wip: {
    earnedRevenue: number;
    billedToDate: number;
    /** + = under-billed (work done > billed → contract asset / unbilled
     *  receivable). − = over-billed (billed ahead of work → deferred revenue
     *  liability). */
    overUnderBilled: number;
    projectCount: number;
    /** False when no project has any cost basis (no job costs and no cost
     *  estimate) — % complete is then undefined, so earned revenue and the
     *  over/under-billing position are NOT meaningful and must not be shown
     *  as real figures. The page renders a "needs cost data" note instead. */
    costBasisAvailable: boolean;
    asOf: string; // ISO timestamp
  };
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
    income: {
      total: 0,
      invoiceCount: 0,
      accounts: [],
      uncategorized: { total: 0, invoiceCount: 0 },
    },
    cogs: { total: 0, accounts: [] },
    opex: { total: 0, accounts: [] },
    uncategorized: { total: 0, entryCount: 0 },
    grossProfit: 0,
    grossMarginPercent: 0,
    netIncome: 0,
    wip: {
      earnedRevenue: 0,
      billedToDate: 0,
      overUnderBilled: 0,
      projectCount: 0,
      costBasisAvailable: false,
      asOf: new Date().toISOString(),
    },
  };
  if (!isDatabaseConfigured()) return empty;
  const db = getDb()!;

  // ----- Income: sum invoice subtotal in range -----
  // Exclude retainage-release invoices: the original invoice's subtotal
  // already recognized the full contract value (incl. the held retainage)
  // on an accrual basis, so counting the release subtotal again would
  // double-count the released portion. (VAT report still counts the
  // release's tax_amount — that VAT is collected at release.)
  const incomeConds = [
    eq(invoices.companyId, companyId),
    ne(invoices.status, 'draft'),
    ne(invoices.status, 'void'),
    ne(invoices.billingType, 'retainage'),
  ];
  if (filters.from) incomeConds.push(gte(invoices.invoiceDate, filters.from));
  if (filters.to) incomeConds.push(lte(invoices.invoiceDate, filters.to));
  // Group by the invoice's revenue category (income-rollup account). Left join
  // so uncategorized invoices (accounting_account_id IS NULL) still aggregate.
  const incomeRows = await db
    .select({
      accountId: invoices.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: sql<string>`COALESCE(SUM(${invoices.subtotal}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(invoices)
    .leftJoin(
      accountingAccounts,
      eq(accountingAccounts.id, invoices.accountingAccountId),
    )
    .where(and(...incomeConds))
    .groupBy(
      invoices.accountingAccountId,
      accountingAccounts.name,
      accountingAccounts.rollupGroup,
    );

  let incomeTotal = 0;
  let incomeInvoiceCount = 0;
  const incomeAccounts: ProfitLossAccountRow[] = [];
  let uncatIncomeTotal = 0;
  let uncatIncomeCount = 0;
  for (const r of incomeRows) {
    const amount = Number(r.total);
    const count = Number(r.count ?? 0);
    incomeTotal += amount;
    incomeInvoiceCount += count;
    if (r.accountId && r.accountName) {
      incomeAccounts.push({
        accountId: r.accountId,
        accountName: r.accountName,
        rollupGroup: (r.rollupGroup as RollupGroup) ?? 'income',
        amount,
        entryCount: count,
      });
    } else {
      uncatIncomeTotal += amount;
      uncatIncomeCount += count;
    }
  }
  incomeAccounts.sort((a, b) => b.amount - a.amount);
  incomeTotal = Math.round(incomeTotal * 100) / 100;
  uncatIncomeTotal = Math.round(uncatIncomeTotal * 100) / 100;

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

  // ----- Expense side (2): categorized bank transactions -----
  // Operating expenses / COGS entered directly on the bank statement (e.g.
  // bank fees, utilities) never create a job_cost_entry, so they must be
  // summed here too. Exclude reconciled rows — those are matched to a
  // receipt / job-cost entry already counted above — and ignored rows. A
  // debit (negative amount) is an expense; a credit categorized to an
  // expense account is a refund, so we sum -amount.
  const bankConds = [
    eq(importedTransactions.companyId, companyId),
    eq(importedTransactions.isIgnored, false),
    isNull(importedTransactions.reconciledAt),
    isNotNull(importedTransactions.accountingAccountId),
  ];
  if (filters.from)
    bankConds.push(gte(importedTransactions.transactionDate, filters.from));
  if (filters.to)
    bankConds.push(lte(importedTransactions.transactionDate, filters.to));

  const bankRows = await db
    .select({
      accountId: importedTransactions.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: sql<string>`COALESCE(SUM(-${importedTransactions.amount}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(importedTransactions)
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, importedTransactions.accountingAccountId),
    )
    .where(and(...bankConds))
    .groupBy(
      importedTransactions.accountingAccountId,
      accountingAccounts.name,
      accountingAccounts.rollupGroup,
    );

  // Merge both expense sources per account so an account that has both a
  // job-cost entry and a bank line shows one combined row.
  const byAccount = new Map<string, ProfitLossAccountRow>();
  const accumulate = (
    rows: Array<{
      accountId: string | null;
      accountName: string;
      rollupGroup: string;
      total: string;
      count: number;
    }>,
  ) => {
    for (const r of rows) {
      if (!r.accountId) continue;
      const amount = Number(r.total);
      const existing = byAccount.get(r.accountId);
      if (existing) {
        existing.amount += amount;
        existing.entryCount += Number(r.count ?? 0);
      } else {
        byAccount.set(r.accountId, {
          accountId: r.accountId,
          accountName: r.accountName,
          rollupGroup: r.rollupGroup as RollupGroup,
          amount,
          entryCount: Number(r.count ?? 0),
        });
      }
    }
  };
  accumulate(categorizedRows);
  accumulate(bankRows);

  const cogsAccounts: ProfitLossAccountRow[] = [];
  const opexAccounts: ProfitLossAccountRow[] = [];
  let cogsTotal = 0;
  let opexTotal = 0;
  for (const row of byAccount.values()) {
    if (row.rollupGroup === 'cogs') {
      cogsAccounts.push(row);
      cogsTotal += row.amount;
    } else if (row.rollupGroup === 'opex') {
      opexAccounts.push(row);
      opexTotal += row.amount;
    }
    // asset / liability / equity / vat_tax / income are balance-sheet items.
  }
  cogsAccounts.sort((a, b) => a.accountName.localeCompare(b.accountName));
  opexAccounts.sort((a, b) => a.accountName.localeCompare(b.accountName));

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

  // Cumulative WIP position (as of today, all projects) — earned revenue is
  // % complete to date, so it is intentionally NOT bounded by the P&L date
  // range. Reuses the WIP report so the two surfaces always agree.
  const wipReport = await buildWipReport(companyId, {
    from: '',
    to: '',
    projectId: '',
    customerId: '',
  });

  return {
    from: filters.from || null,
    to: filters.to || null,
    income: {
      total: incomeTotal,
      invoiceCount: incomeInvoiceCount,
      accounts: incomeAccounts,
      uncategorized: {
        total: uncatIncomeTotal,
        invoiceCount: uncatIncomeCount,
      },
    },
    cogs: { total: cogsTotal, accounts: cogsAccounts },
    opex: { total: opexTotal, accounts: opexAccounts },
    uncategorized: {
      total: uncategorizedTotal,
      entryCount: uncategorizedCount,
    },
    grossProfit,
    grossMarginPercent,
    netIncome,
    wip: {
      earnedRevenue: wipReport.summary.revenueEarned,
      billedToDate: wipReport.summary.billedToDate,
      overUnderBilled: wipReport.summary.overUnderBilled,
      projectCount: wipReport.summary.projectCount,
      // No cost-to-date anywhere AND no estimate → projectedFinalCost is 0, so
      // % complete (and earned revenue) can't be computed for any project.
      costBasisAvailable: wipReport.summary.projectedFinalCost > 0,
      asOf: wipReport.asOf.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Drill-down: the individual entries behind one P&L account line, so clicking
// "Fuel — $200" on the report shows the actual gas charges that made it up.
// Same two sources + same range/de-dup rules as buildProfitLossReport.
// ---------------------------------------------------------------------------

export type ProfitLossAccountEntry = {
  date: string;
  description: string;
  amount: number;
  source: 'Bank transaction' | 'Job cost';
};

export type ProfitLossAccountDetail = {
  accountId: string;
  accountName: string;
  rollupGroup: RollupGroup;
  total: number;
  entries: ProfitLossAccountEntry[];
};

export async function listProfitLossAccountEntries(
  companyId: string,
  accountId: string,
  filters: ProfitLossFilters,
): Promise<ProfitLossAccountDetail | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;

  const accRows = await db
    .select({
      id: accountingAccounts.id,
      name: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
    })
    .from(accountingAccounts)
    .where(
      and(
        eq(accountingAccounts.id, accountId),
        eq(accountingAccounts.companyId, companyId),
      ),
    )
    .limit(1);
  const acc = accRows[0];
  if (!acc) return null;

  // Job-cost entries on this account.
  const jceConds = [
    eq(jobCostEntries.companyId, companyId),
    sql`${jobCostEntries.deletedAt} IS NULL`,
    eq(jobCostEntries.accountingAccountId, accountId),
  ];
  if (filters.from) jceConds.push(gte(jobCostEntries.entryDate, filters.from));
  if (filters.to) jceConds.push(lte(jobCostEntries.entryDate, filters.to));
  const jceRows = await db
    .select({
      date: jobCostEntries.entryDate,
      description: jobCostEntries.description,
      amount: jobCostEntries.amount,
    })
    .from(jobCostEntries)
    .where(and(...jceConds));

  // Categorized bank transactions on this account (unreconciled, not ignored).
  const btConds = [
    eq(importedTransactions.companyId, companyId),
    eq(importedTransactions.isIgnored, false),
    isNull(importedTransactions.reconciledAt),
    eq(importedTransactions.accountingAccountId, accountId),
  ];
  if (filters.from)
    btConds.push(gte(importedTransactions.transactionDate, filters.from));
  if (filters.to)
    btConds.push(lte(importedTransactions.transactionDate, filters.to));
  const btRows = await db
    .select({
      date: importedTransactions.transactionDate,
      description: importedTransactions.description,
      amount: importedTransactions.amount,
    })
    .from(importedTransactions)
    .where(and(...btConds));

  const entries: ProfitLossAccountEntry[] = [
    ...jceRows.map((r) => ({
      date: r.date,
      description: r.description,
      amount: Number(r.amount),
      source: 'Job cost' as const,
    })),
    ...btRows.map((r) => ({
      date: r.date,
      description: r.description,
      // Stored signed (negative = debit); expense magnitude is -amount.
      amount: -Number(r.amount),
      source: 'Bank transaction' as const,
    })),
  ];
  entries.sort((a, b) => a.date.localeCompare(b.date));
  const total = entries.reduce((s, e) => s + e.amount, 0);

  return {
    accountId: acc.id,
    accountName: acc.name,
    rollupGroup: acc.rollupGroup as RollupGroup,
    total,
    entries,
  };
}
