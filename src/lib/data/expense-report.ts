// Expense report — every operational expense line in one list, filterable by
// bank/CC account, categories (multi), job, vendor, and payment method.
//
// Row sources mirror the P&L's expense side so the report ties to the books
// (minus payroll, which lives on its own surfaces):
//   A. Categorized bank/CC transactions (unmatched — matched ones surface
//      through their receipt), COGS/OpEx categories only.
//   B. Split-transaction lines (signed; the parent txn carries account /
//      vendor / payment method).
//   C. POSTED receipt lines (bills/receipts) — ex-VAT when VAT is
//      recoverable, gross otherwise, exactly like the P&L.
//   D. Bank-fee split lines on reconciled bill payments.

import 'server-only';
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  accountingAccounts,
  bankAccounts,
  importedTransactions,
  importedTransactionLines,
  paymentMethods,
  projects,
  receipts,
  receiptLines,
  transactionMatches,
  vendors,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ExpenseReportFilters = {
  from?: string;
  to?: string;
  bankAccountId?: string;
  categoryIds?: string[];
  projectId?: string;
  vendorId?: string;
  paymentMethodId?: string;
};

export type ExpenseRow = {
  key: string;
  date: string;
  description: string;
  source: 'Bank transaction' | 'Receipt';
  vendorName: string | null;
  categoryId: string | null;
  categoryName: string;
  projectName: string | null;
  /** The bank / credit-card account the money moved through ("Cash" for
   *  cash receipts, "—" for unpaid bills). */
  accountName: string;
  paymentMethodName: string | null;
  /** Positive = expense; negative = refund/credit. */
  amount: number;
  href: string;
};

export type ExpenseReport = {
  rows: ExpenseRow[];
  total: number;
  rowCount: number;
  truncated: boolean;
};

const EXPENSE_ROLLUPS = ['cogs', 'opex'] as const;
const ROW_CAP = 2000;

export async function buildExpenseReport(
  companyId: string,
  filters: ExpenseReportFilters,
): Promise<ExpenseReport> {
  if (!isDatabaseConfigured()) {
    return { rows: [], total: 0, rowCount: 0, truncated: false };
  }
  const db = getDb()!;
  const rows: ExpenseRow[] = [];

  const catFilter =
    filters.categoryIds && filters.categoryIds.length > 0
      ? filters.categoryIds
      : null;

  // ----- A. Categorized bank/CC transactions (single category) -----
  // "Effectively unmatched" mirrors the P&L: not reconciled, OR reconciled
  // only by receipt-matches to DRAFT scan-holders (no posted receipt) — a
  // draft posts no bill, so the txn's own category still carries the cost.
  const effectivelyUnmatched = sql`(
    ${importedTransactions.reconciledAt} IS NULL OR (
      NOT EXISTS (
        SELECT 1 FROM ${transactionMatches} mo
        WHERE mo.imported_transaction_id = ${importedTransactions.id}
          AND mo.reversed_at IS NULL AND mo.match_type <> 'receipt')
      AND EXISTS (
        SELECT 1 FROM ${transactionMatches} mr
        WHERE mr.imported_transaction_id = ${importedTransactions.id}
          AND mr.reversed_at IS NULL AND mr.match_type = 'receipt')
      AND NOT EXISTS (
        SELECT 1 FROM ${transactionMatches} mp
        JOIN ${receipts} rp ON rp.id = mp.receipt_id
        WHERE mp.imported_transaction_id = ${importedTransactions.id}
          AND mp.reversed_at IS NULL AND mp.match_type = 'receipt'
          AND rp.status = 'posted' AND rp.deleted_at IS NULL)
    )
  )`;
  const txnConds = [
    eq(importedTransactions.companyId, companyId),
    eq(importedTransactions.isIgnored, false),
    effectivelyUnmatched,
    isNotNull(importedTransactions.accountingAccountId),
    inArray(accountingAccounts.rollupGroup, [...EXPENSE_ROLLUPS]),
  ];
  if (filters.from) txnConds.push(gte(importedTransactions.transactionDate, filters.from));
  if (filters.to) txnConds.push(lte(importedTransactions.transactionDate, filters.to));
  if (filters.bankAccountId) txnConds.push(eq(importedTransactions.bankAccountId, filters.bankAccountId));
  if (catFilter) txnConds.push(inArray(importedTransactions.accountingAccountId, catFilter));
  if (filters.projectId) txnConds.push(eq(importedTransactions.projectId, filters.projectId));
  if (filters.vendorId) txnConds.push(eq(importedTransactions.vendorId, filters.vendorId));
  if (filters.paymentMethodId) txnConds.push(eq(importedTransactions.paymentMethodId, filters.paymentMethodId));

  const txnRows = await db
    .select({
      id: importedTransactions.id,
      date: importedTransactions.transactionDate,
      description: importedTransactions.description,
      amount: importedTransactions.amount,
      bankAccountId: importedTransactions.bankAccountId,
      accountName: bankAccounts.name,
      categoryId: importedTransactions.accountingAccountId,
      categoryName: accountingAccounts.name,
      vendorName: vendors.name,
      projectName: projects.name,
      methodName: paymentMethods.name,
    })
    .from(importedTransactions)
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, importedTransactions.accountingAccountId),
    )
    .innerJoin(bankAccounts, eq(bankAccounts.id, importedTransactions.bankAccountId))
    .leftJoin(vendors, eq(vendors.id, importedTransactions.vendorId))
    .leftJoin(projects, eq(projects.id, importedTransactions.projectId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, importedTransactions.paymentMethodId))
    .where(and(...txnConds));

  for (const t of txnRows) {
    rows.push({
      key: `txn:${t.id}`,
      date: t.date,
      description: t.description,
      source: 'Bank transaction',
      vendorName: t.vendorName ?? null,
      categoryId: t.categoryId,
      categoryName: t.categoryName,
      projectName: t.projectName ?? null,
      accountName: t.accountName,
      paymentMethodName: t.methodName ?? null,
      amount: r2(-Number(t.amount)),
      href: `/banking/accounts/${t.bankAccountId}?q=${encodeURIComponent(t.description)}&reviewed=1`,
    });
  }

  // ----- B + D. Split lines (uncategorized parents) and bill-payment fee
  // lines (reconciled parents matched to a receipt) -----
  const lineConds = [
    eq(importedTransactionLines.companyId, companyId),
    eq(importedTransactions.isIgnored, false),
    isNotNull(importedTransactionLines.accountingAccountId),
    inArray(accountingAccounts.rollupGroup, [...EXPENSE_ROLLUPS]),
  ];
  if (filters.from) lineConds.push(gte(importedTransactions.transactionDate, filters.from));
  if (filters.to) lineConds.push(lte(importedTransactions.transactionDate, filters.to));
  if (filters.bankAccountId) lineConds.push(eq(importedTransactions.bankAccountId, filters.bankAccountId));
  if (catFilter) lineConds.push(inArray(importedTransactionLines.accountingAccountId, catFilter));
  if (filters.projectId) lineConds.push(eq(importedTransactionLines.projectId, filters.projectId));
  if (filters.vendorId) lineConds.push(eq(importedTransactions.vendorId, filters.vendorId));
  if (filters.paymentMethodId) lineConds.push(eq(importedTransactions.paymentMethodId, filters.paymentMethodId));

  const lineRows = await db
    .select({
      lineId: importedTransactionLines.id,
      txnId: importedTransactions.id,
      date: importedTransactions.transactionDate,
      txnDescription: importedTransactions.description,
      lineDescription: importedTransactionLines.description,
      lineAmount: importedTransactionLines.amount,
      txnAmount: importedTransactions.amount,
      txnCategoryId: importedTransactions.accountingAccountId,
      reconciledAt: importedTransactions.reconciledAt,
      bankAccountId: importedTransactions.bankAccountId,
      accountName: bankAccounts.name,
      categoryId: importedTransactionLines.accountingAccountId,
      categoryName: accountingAccounts.name,
      vendorName: vendors.name,
      projectName: projects.name,
      methodName: paymentMethods.name,
      matchType: transactionMatches.matchType,
      matchedReceiptStatus: receipts.status,
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
    .innerJoin(bankAccounts, eq(bankAccounts.id, importedTransactions.bankAccountId))
    .leftJoin(vendors, eq(vendors.id, importedTransactions.vendorId))
    .leftJoin(projects, eq(projects.id, importedTransactionLines.projectId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, importedTransactions.paymentMethodId))
    .leftJoin(
      transactionMatches,
      and(
        eq(transactionMatches.importedTransactionId, importedTransactions.id),
        isNull(transactionMatches.reversedAt),
      ),
    )
    .leftJoin(receipts, eq(receipts.id, transactionMatches.receiptId))
    .where(and(...lineConds));

  const seenLines = new Set<string>();
  for (const l of lineRows) {
    // A txn can carry several active matches (batch bill payments) — the
    // join then repeats each line; keep one row per line.
    if (seenLines.has(l.lineId)) continue;
    seenLines.add(l.lineId);
    // B: plain split (txn-level category NULL) — including one whose only
    //    match is a DRAFT scan-holder receipt: no bill posted, so the split
    //    lines ARE the cost (mirrors the P&L's effectively-unmatched rule).
    // D: fee line on a reconciled bill payment (payroll bill, or a receipt
    //    match backed by a POSTED receipt).
    const postedBillMatch =
      l.matchType === 'payroll_bill' ||
      (l.matchType === 'receipt' && l.matchedReceiptStatus === 'posted');
    const draftHolderMatch =
      l.matchType === 'receipt' && l.matchedReceiptStatus !== 'posted';
    const isPlainSplit =
      l.txnCategoryId === null && (!l.reconciledAt || draftHolderMatch);
    const isBillFee = l.reconciledAt !== null && postedBillMatch;
    if (!isPlainSplit && !isBillFee) continue;
    const signed = Number(l.lineAmount);
    const expense = Number(l.txnAmount) < 0 ? signed : -signed;
    rows.push({
      key: `line:${l.lineId}`,
      date: l.date,
      description: l.lineDescription
        ? `${l.txnDescription} — ${l.lineDescription}`
        : l.txnDescription,
      source: 'Bank transaction',
      vendorName: l.vendorName ?? null,
      categoryId: l.categoryId,
      categoryName: l.categoryName,
      projectName: l.projectName ?? null,
      accountName: l.accountName,
      paymentMethodName: l.methodName ?? null,
      amount: r2(expense),
      href: `/banking/accounts/${l.bankAccountId}?q=${encodeURIComponent(l.txnDescription)}&reviewed=1`,
    });
  }

  // ----- C. Posted receipt lines -----
  const receiptConds = [
    eq(receiptLines.companyId, companyId),
    eq(receipts.status, 'posted'),
    isNull(receiptLines.deletedAt),
    isNotNull(receiptLines.accountingAccountId),
    inArray(accountingAccounts.rollupGroup, [...EXPENSE_ROLLUPS]),
  ];
  if (filters.from) receiptConds.push(gte(receipts.receiptDate, filters.from));
  if (filters.to) receiptConds.push(lte(receipts.receiptDate, filters.to));
  if (filters.bankAccountId) receiptConds.push(eq(receipts.bankAccountId, filters.bankAccountId));
  if (catFilter) receiptConds.push(inArray(receiptLines.accountingAccountId, catFilter));
  if (filters.projectId) receiptConds.push(eq(receiptLines.projectId, filters.projectId));
  if (filters.vendorId) receiptConds.push(eq(receipts.vendorId, filters.vendorId));
  if (filters.paymentMethodId) receiptConds.push(eq(receipts.paymentMethodId, filters.paymentMethodId));

  const rcptRows = await db
    .select({
      lineId: receiptLines.id,
      receiptId: receipts.id,
      date: receipts.receiptDate,
      lineDescription: receiptLines.description,
      subtotal: receiptLines.subtotal,
      lineTotal: receiptLines.total,
      vatRecoverable: receipts.vatRecoverable,
      paymentSourceType: receipts.paymentSourceType,
      accountName: bankAccounts.name,
      categoryId: receiptLines.accountingAccountId,
      categoryName: accountingAccounts.name,
      vendorName: vendors.name,
      projectName: projects.name,
      methodName: paymentMethods.name,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .innerJoin(
      accountingAccounts,
      eq(accountingAccounts.id, receiptLines.accountingAccountId),
    )
    .leftJoin(bankAccounts, eq(bankAccounts.id, receipts.bankAccountId))
    .leftJoin(vendors, eq(vendors.id, receipts.vendorId))
    .leftJoin(projects, eq(projects.id, receiptLines.projectId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, receipts.paymentMethodId))
    .where(and(...receiptConds));

  for (const r of rcptRows) {
    const amount = r.vatRecoverable ? Number(r.subtotal) : Number(r.lineTotal);
    rows.push({
      key: `rcpt:${r.lineId}`,
      date: r.date,
      description: r.lineDescription || 'Receipt line',
      source: 'Receipt',
      vendorName: r.vendorName ?? null,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      projectName: r.projectName ?? null,
      accountName:
        r.accountName ??
        (r.paymentSourceType === 'cash' ? 'Cash' : '—'),
      paymentMethodName: r.methodName ?? null,
      amount: r2(amount),
      href: `/banking/receipts/${r.receiptId}`,
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const total = r2(rows.reduce((s, r) => s + r.amount, 0));
  const truncated = rows.length > ROW_CAP;
  return {
    rows: rows.slice(0, ROW_CAP),
    total,
    rowCount: rows.length,
    truncated,
  };
}
