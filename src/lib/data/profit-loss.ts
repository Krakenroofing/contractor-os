// Data layer for the P&L (Income Statement) report — Accounting Phase 2.
//
// Income side: sum invoiced net-of-retainage (net, ex-VAT) within the date
// range, for invoices not in 'draft' or 'void' status. Billed basis — held
// retainage is recognized when released, not when first billed. Invoices
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
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  accountingAccounts,
  importedTransactions,
  importedTransactionLines,
  transactionMatches,
  invoices,
  jobCostEntries,
  receipts,
  receiptLines,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { getCompany } from '@/lib/data/companies';
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
 * Earliest date that contributes to the P&L (min over income invoices, posted
 * job-cost entries, and categorized bank lines), plus today as the upper bound.
 * Used to pre-fill the report's date inputs when the user hasn't picked a range,
 * so the visible "from → to" matches the data actually shown (not blank fields).
 * `from` is null when the company has no P&L activity at all.
 */
export async function getProfitLossActivityRange(
  companyId: string,
): Promise<{ from: string | null; to: string }> {
  const to = new Date().toISOString().slice(0, 10);
  if (!isDatabaseConfigured()) return { from: null, to };
  const db = getDb()!;
  const rows = await db.execute<{ from: string | null }>(sql`
    SELECT MIN(d)::text AS from FROM (
      SELECT MIN(${invoices.invoiceDate}) AS d FROM ${invoices}
        WHERE ${invoices.companyId} = ${companyId}
          AND ${invoices.status} NOT IN ('draft','void')
      UNION ALL
      SELECT MIN(${jobCostEntries.entryDate}) AS d FROM ${jobCostEntries}
        WHERE ${jobCostEntries.companyId} = ${companyId}
          AND ${jobCostEntries.deletedAt} IS NULL
      UNION ALL
      SELECT MIN(${importedTransactions.transactionDate}) AS d FROM ${importedTransactions}
        WHERE ${importedTransactions.companyId} = ${companyId}
          AND ${importedTransactions.isIgnored} = false
          AND ${importedTransactions.accountingAccountId} IS NOT NULL
    ) AS mins
  `);
  return { from: rows[0]?.from ?? null, to };
}

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

  // ----- Income: sum invoiced revenue in range -----
  // Recognition basis comes from the company setting (Settings → Accounting):
  //  - 'billed'  (default): recognize what's invoiced now = subtotal minus the
  //    held retainage; the held part is recognized later via the retainage-
  //    release invoice (retainageAmount 0, so it counts in full at release).
  //  - 'accrual': recognize the full contract value when first billed, and
  //    EXCLUDE the retainage-release invoice (it was already counted up front).
  const company = await getCompany(companyId);
  const accrualBasis = company?.retainageRevenueBasis === 'accrual';
  const incomeNet = accrualBasis
    ? sql<string>`COALESCE(SUM(${invoices.subtotal}), 0)`
    : sql<string>`COALESCE(SUM(${invoices.subtotal} - COALESCE(${invoices.retainageAmount}, 0)), 0)`;
  const incomeConds = [
    eq(invoices.companyId, companyId),
    ne(invoices.status, 'draft'),
    ne(invoices.status, 'void'),
  ];
  if (accrualBasis) incomeConds.push(ne(invoices.billingType, 'retainage'));
  if (filters.from) incomeConds.push(gte(invoices.invoiceDate, filters.from));
  if (filters.to) incomeConds.push(lte(invoices.invoiceDate, filters.to));
  // Group by the invoice's revenue category (income-rollup account). Left join
  // so uncategorized invoices (accounting_account_id IS NULL) still aggregate.
  const incomeRows = await db
    .select({
      accountId: invoices.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: incomeNet,
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

  // ----- Expense side (2b): SPLIT bank transactions -----
  // A split/itemized transaction stores its categories on
  // imported_transaction_lines and leaves the transaction-level category
  // NULL, so source 2 misses it entirely — the classic case being an
  // auto-VAT split (cost line + Vat Receivable line). Sum the lines of
  // unreconciled, non-ignored, txn-level-uncategorized transactions by
  // line account; balance-sheet lines (e.g. Vat Receivable) fall out of
  // the P&L via the rollup-group filter below, exactly as intended. Line
  // amounts are positive magnitudes; a debit txn (amount < 0) is an
  // expense, a credit split is a refund.
  const splitConds = [
    eq(importedTransactionLines.companyId, companyId),
    eq(importedTransactions.isIgnored, false),
    isNull(importedTransactions.reconciledAt),
    isNull(importedTransactions.accountingAccountId),
    isNotNull(importedTransactionLines.accountingAccountId),
  ];
  if (filters.from)
    splitConds.push(gte(importedTransactions.transactionDate, filters.from));
  if (filters.to)
    splitConds.push(lte(importedTransactions.transactionDate, filters.to));
  const splitRows = await db
    .select({
      accountId: importedTransactionLines.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: sql<string>`COALESCE(SUM(CASE WHEN ${importedTransactions.amount} < 0 THEN ${importedTransactionLines.amount} ELSE -${importedTransactionLines.amount} END), 0)`,
      count: sql<number>`COUNT(*)::int`,
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
    .where(and(...splitConds))
    .groupBy(
      importedTransactionLines.accountingAccountId,
      accountingAccounts.name,
      accountingAccounts.rollupGroup,
    );

  // ----- Expense side (3): overhead posted-receipt lines -----
  // A posted receipt line with a category but NO project/cost code (e.g. a
  // cash gas receipt) never creates a job_cost_entry, so it isn't in source 1;
  // and a cash receipt has no bank line (and a bank-paid one is excluded from
  // source 2 as "matched to a receipt"). Count those lines here, by category,
  // at the same net/gross basis posting uses (net when VAT is recoverable).
  const receiptExpenseAmt = company?.isVatActive
    ? sql`CASE WHEN ${receipts.vatRecoverable} THEN ${receiptLines.subtotal} ELSE ${receiptLines.total} END`
    : sql`${receiptLines.total}`;
  const receiptConds = [
    eq(receipts.companyId, companyId),
    eq(receipts.status, 'posted'),
    isNull(receipts.deletedAt),
    isNull(receiptLines.postedJobCostEntryId),
    isNotNull(receiptLines.accountingAccountId),
  ];
  if (filters.from) receiptConds.push(gte(receipts.receiptDate, filters.from));
  if (filters.to) receiptConds.push(lte(receipts.receiptDate, filters.to));

  const receiptOverheadRows = await db
    .select({
      accountId: receiptLines.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: sql<string>`COALESCE(SUM(${receiptExpenseAmt}), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, receiptLines.accountingAccountId),
    )
    .where(and(...receiptConds))
    .groupBy(
      receiptLines.accountingAccountId,
      accountingAccounts.name,
      accountingAccounts.rollupGroup,
    );

  // Merge the expense sources per account so an account that has e.g. a
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
  accumulate(splitRows);
  accumulate(receiptOverheadRows);

  // ----- Bank fees on bill payments -----
  // A bill payment reconciles the bank line (so it's excluded above), but its
  // split line is the bank/transaction fee — a real expense on the payment
  // date. Count those fee lines (split lines on reconciled txns matched to a
  // bill/receipt), dated by the transaction.
  const billPaymentTxnIds = db
    .select({ id: transactionMatches.importedTransactionId })
    .from(transactionMatches)
    .where(
      and(
        eq(transactionMatches.companyId, companyId),
        eq(transactionMatches.matchType, 'receipt'),
        isNull(transactionMatches.reversedAt),
      ),
    );
  const feeConds = [
    eq(importedTransactionLines.companyId, companyId),
    isNotNull(importedTransactions.reconciledAt),
    isNotNull(importedTransactionLines.accountingAccountId),
    inArray(importedTransactions.id, billPaymentTxnIds),
  ];
  if (filters.from)
    feeConds.push(gte(importedTransactions.transactionDate, filters.from));
  if (filters.to)
    feeConds.push(lte(importedTransactions.transactionDate, filters.to));
  const feeRows = await db
    .select({
      accountId: importedTransactionLines.accountingAccountId,
      accountName: accountingAccounts.name,
      rollupGroup: accountingAccounts.rollupGroup,
      total: sql<string>`COALESCE(SUM(${importedTransactionLines.amount}), 0)`,
      count: sql<number>`COUNT(*)::int`,
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
    .where(and(...feeConds))
    .groupBy(
      importedTransactionLines.accountingAccountId,
      accountingAccounts.name,
      accountingAccounts.rollupGroup,
    );
  accumulate(feeRows);

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
  /** Source row id so the drill-down can deep-link to the full record.
   *  Exactly one is set per entry, matching `source`. */
  importedTransactionId?: string;
  jobCostEntryId?: string;
  /** Linked supplier, when the source row has one — lets the row name
   *  deep-link to the vendor's transaction history. */
  vendorId?: string | null;
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
      id: jobCostEntries.id,
      date: jobCostEntries.entryDate,
      description: jobCostEntries.description,
      amount: jobCostEntries.amount,
      vendorId: jobCostEntries.vendorId,
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
      id: importedTransactions.id,
      date: importedTransactions.transactionDate,
      description: importedTransactions.description,
      amount: importedTransactions.amount,
      vendorId: importedTransactions.vendorId,
    })
    .from(importedTransactions)
    .where(and(...btConds));

  // Split-transaction lines on this account. The parent transaction has no
  // txn-level category (categories live per line), so the query above misses
  // these — mirrors expense source 2b in buildProfitLossReport.
  const slConds = [
    eq(importedTransactionLines.companyId, companyId),
    eq(importedTransactionLines.accountingAccountId, accountId),
    eq(importedTransactions.isIgnored, false),
    isNull(importedTransactions.reconciledAt),
    isNull(importedTransactions.accountingAccountId),
  ];
  if (filters.from)
    slConds.push(gte(importedTransactions.transactionDate, filters.from));
  if (filters.to)
    slConds.push(lte(importedTransactions.transactionDate, filters.to));
  const slRows = await db
    .select({
      id: importedTransactions.id,
      date: importedTransactions.transactionDate,
      txnDescription: importedTransactions.description,
      lineDescription: importedTransactionLines.description,
      lineAmount: importedTransactionLines.amount,
      txnAmount: importedTransactions.amount,
      vendorId: importedTransactions.vendorId,
    })
    .from(importedTransactionLines)
    .innerJoin(
      importedTransactions,
      eq(importedTransactions.id, importedTransactionLines.importedTransactionId),
    )
    .where(and(...slConds));

  const entries: ProfitLossAccountEntry[] = [
    ...jceRows.map((r) => ({
      date: r.date,
      description: r.description,
      amount: Number(r.amount),
      source: 'Job cost' as const,
      jobCostEntryId: r.id,
      vendorId: r.vendorId,
    })),
    ...btRows.map((r) => ({
      date: r.date,
      description: r.description,
      // Stored signed (negative = debit); expense magnitude is -amount.
      amount: -Number(r.amount),
      source: 'Bank transaction' as const,
      importedTransactionId: r.id,
      vendorId: r.vendorId,
    })),
    ...slRows.map((r) => ({
      date: r.date,
      description:
        r.lineDescription && r.lineDescription.trim() !== ''
          ? `${r.txnDescription} — ${r.lineDescription}`
          : r.txnDescription,
      // Line amounts are positive magnitudes; the parent txn's sign says
      // whether this is an expense (debit) or a refund (credit).
      amount: Number(r.txnAmount) < 0 ? Number(r.lineAmount) : -Number(r.lineAmount),
      source: 'Bank transaction' as const,
      importedTransactionId: r.id,
      vendorId: r.vendorId,
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

// ---------------------------------------------------------------------------
// Revenue drill-down: the individual invoices behind the P&L income total (or
// one revenue category). Uses the SAME filters as buildProfitLossReport's
// income side so the list ties to the number on the statement — for
// month-to-month reconciliation.
// ---------------------------------------------------------------------------

export type ProfitLossRevenueEntry = {
  invoiceId: string;
  number: string;
  date: string;
  status: string;
  customerName: string;
  projectName: string;
  categoryName: string | null;
  /** Ex-VAT, net of retainage — the billed net that counts as revenue on the
   *  P&L (subtotal minus held retainage). Ties to `total` ÷ (1 + VAT rate). */
  subtotal: number;
  /** Gross (incl. VAT) — for tie-out against the invoice document. */
  total: number;
};

export type ProfitLossRevenueDetail = {
  scopeLabel: string;
  total: number;
  entries: ProfitLossRevenueEntry[];
};

export async function listProfitLossRevenueEntries(
  companyId: string,
  filters: ProfitLossFilters,
  /** undefined = all revenue; 'uncategorized' = no revenue category; else a
   *  specific accounting_accounts id. */
  accountId?: string,
): Promise<ProfitLossRevenueDetail | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;

  // Same recognition basis as buildProfitLossReport so the drill-down ties to
  // the statement's Income line (see that function for the full rationale).
  const company = await getCompany(companyId);
  const accrualBasis = company?.retainageRevenueBasis === 'accrual';

  const conds = [
    eq(invoices.companyId, companyId),
    ne(invoices.status, 'draft'),
    ne(invoices.status, 'void'),
  ];
  if (accrualBasis) conds.push(ne(invoices.billingType, 'retainage'));
  if (filters.from) conds.push(gte(invoices.invoiceDate, filters.from));
  if (filters.to) conds.push(lte(invoices.invoiceDate, filters.to));
  if (accountId === 'uncategorized') {
    conds.push(isNull(invoices.accountingAccountId));
  } else if (accountId) {
    conds.push(eq(invoices.accountingAccountId, accountId));
  }

  const rows = await db
    .select({
      invoiceId: invoices.id,
      number: invoices.number,
      date: invoices.invoiceDate,
      status: invoices.status,
      projectId: invoices.projectId,
      subtotal: invoices.subtotal,
      retainageAmount: invoices.retainageAmount,
      total: invoices.total,
      categoryName: accountingAccounts.name,
    })
    .from(invoices)
    .leftJoin(
      accountingAccounts,
      eq(accountingAccounts.id, invoices.accountingAccountId),
    )
    .where(and(...conds))
    .orderBy(invoices.invoiceDate);

  const [projects, customers] = await Promise.all([
    listProjects(companyId),
    listCustomers(companyId),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  let total = 0;
  const entries: ProfitLossRevenueEntry[] = rows.map((r) => {
    const project = r.projectId ? projectById.get(r.projectId) : undefined;
    const customer = project
      ? customerById.get(project.customerId)
      : undefined;
    // Billed basis: net of held retainage, so ex-VAT ties to the gross shown.
    // Accrual basis: the full subtotal (retainage recognized up front).
    const subtotal = accrualBasis
      ? Number(r.subtotal)
      : Number(r.subtotal) - Number(r.retainageAmount ?? 0);
    total += subtotal;
    return {
      invoiceId: r.invoiceId,
      number: r.number,
      date: r.date,
      status: r.status,
      customerName: customer?.name ?? '—',
      projectName: project?.name ?? '—',
      categoryName: r.categoryName ?? null,
      subtotal,
      total: Number(r.total),
    };
  });

  const scopeLabel =
    accountId === 'uncategorized'
      ? 'Uncategorized revenue'
      : accountId
        ? (entries.find((e) => e.categoryName)?.categoryName ??
          'Revenue category')
        : 'All revenue';

  return {
    scopeLabel,
    total: Math.round(total * 100) / 100,
    entries,
  };
}
