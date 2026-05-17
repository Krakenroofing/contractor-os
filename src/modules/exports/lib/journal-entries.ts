// Builds journal-entry-shape rows for the accountant CSV export.
//
// Source events covered in this phase:
//   - Posted receipts (AP — money out of bank/CC/cash)
//   - Invoice payments (AR — money in to bank)
//   - Matched transfers (bank-to-bank movement)
//   - Owner contribution / draw matches (equity movement)
//
// Invoices themselves are NOT exported as journal entries here. The
// accountant runs their own books for accruals; this export gives them the
// cash-side activity so reconciliation against their bank feeds is
// straightforward. Future Phase 5b can add accrual-side exports.
//
// Stateless: every call regenerates the full window. Idempotency is the
// operator's responsibility (= don't import the same window twice).

import 'server-only';
import { round2, toMoneyString } from '@/lib/money';
import type {
  AccountingAccount,
  BankAccount,
  ImportedTransaction,
  Invoice,
  InvoicePayment,
  Receipt,
  TransactionMatch,
  Vendor,
} from '@/db/schema';

export type JournalEntryRow = {
  date: string; // ISO YYYY-MM-DD
  /** Human-readable memo. Goes in the CSV 'Memo' column. */
  memo: string;
  /** Account label like "6000 — Operating Expense" or "Bank: TRB Checking".
   *  Free text — the accountant maps to their own COA on import. */
  account: string;
  /** Empty string when this is the credit side. */
  debit: string;
  /** Empty string when this is the debit side. */
  credit: string;
  /** Source kind for the CSV's "Source" column. */
  source:
    | 'receipt'
    | 'invoice_payment'
    | 'transfer'
    | 'owner_contribution'
    | 'owner_draw';
  /** Source row id (receipt.id / invoice_payment.id / imported_transactions.id). */
  sourceRefId: string;
  /** Optional reference for the accountant — invoice number, vendor invoice, etc. */
  reference: string;
};

export type BuildJournalInput = {
  fromDate?: string;
  toDate?: string;
  isVatActive: boolean;
  // Reference data — pre-loaded by the route handler so this stays pure.
  receipts: Receipt[];
  invoicePayments: InvoicePayment[];
  invoices: Invoice[];
  bankAccounts: BankAccount[];
  accountingAccounts: AccountingAccount[];
  vendors: Vendor[];
  importedTransactions: ImportedTransaction[];
  /** Active (non-reversed) matches. */
  transactionMatches: TransactionMatch[];
};

function inRange(iso: string, from?: string, to?: string): boolean {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

function bankAccountLabel(
  ba: BankAccount | undefined,
  coa: Map<string, AccountingAccount>,
): string {
  if (!ba) return 'Bank — unspecified';
  const linked = coa.get(ba.accountingAccountId);
  if (linked) {
    return linked.code
      ? `${linked.code} ${linked.name} (${ba.name})`
      : `${linked.name} (${ba.name})`;
  }
  return ba.type === 'credit_card'
    ? `Credit Card: ${ba.name}`
    : `Bank: ${ba.name}`;
}

function paymentSourceLabel(
  receipt: Receipt,
  bankAccounts: Map<string, BankAccount>,
  coa: Map<string, AccountingAccount>,
): string {
  if (
    (receipt.paymentSourceType === 'bank' ||
      receipt.paymentSourceType === 'credit_card') &&
    receipt.bankAccountId
  ) {
    return bankAccountLabel(bankAccounts.get(receipt.bankAccountId), coa);
  }
  if (receipt.paymentSourceType === 'cash') return 'Cash on hand';
  return 'Other';
}

function accountLabelById(
  id: string | null,
  coa: Map<string, AccountingAccount>,
  fallback: string,
): string {
  if (!id) return fallback;
  const a = coa.get(id);
  if (!a) return fallback;
  return a.code ? `${a.code} ${a.name}` : a.name;
}

function findCoaByType(
  accounts: AccountingAccount[],
  type: AccountingAccount['type'],
): AccountingAccount | undefined {
  return accounts.find((a) => a.type === type && !a.isArchived);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildJournalEntries(
  input: BuildJournalInput,
): JournalEntryRow[] {
  const rows: JournalEntryRow[] = [];
  const coaById = new Map(input.accountingAccounts.map((a) => [a.id, a]));
  const bankById = new Map(input.bankAccounts.map((b) => [b.id, b]));
  const vendorById = new Map(input.vendors.map((v) => [v.id, v]));
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));
  const txnById = new Map(input.importedTransactions.map((t) => [t.id, t]));

  // Default category fallbacks (used when a receipt has no
  // accountingAccountId set — happens for old/quick receipts).
  const expenseDefault =
    findCoaByType(input.accountingAccounts, 'uncategorized_expense') ??
    findCoaByType(input.accountingAccounts, 'expense');
  const incomeDefault =
    findCoaByType(input.accountingAccounts, 'uncategorized_income') ??
    findCoaByType(input.accountingAccounts, 'income');
  const ownerEquity = findCoaByType(input.accountingAccounts, 'owner_equity');
  const vatInput = findCoaByType(input.accountingAccounts, 'vat_input');

  const expenseFallbackLabel = expenseDefault
    ? expenseDefault.code
      ? `${expenseDefault.code} ${expenseDefault.name}`
      : expenseDefault.name
    : 'Uncategorized Expense';
  const incomeFallbackLabel = incomeDefault
    ? incomeDefault.code
      ? `${incomeDefault.code} ${incomeDefault.name}`
      : incomeDefault.name
    : 'Sales / Income';
  const ownerEquityLabel = ownerEquity
    ? ownerEquity.code
      ? `${ownerEquity.code} ${ownerEquity.name}`
      : ownerEquity.name
    : "Owner's Equity";
  const vatInputLabel = vatInput
    ? vatInput.code
      ? `${vatInput.code} ${vatInput.name}`
      : vatInput.name
    : 'VAT Input (Recoverable)';

  // ===== Posted receipts =====
  for (const r of input.receipts) {
    if (r.status !== 'posted') continue;
    if (!inRange(r.receiptDate, input.fromDate, input.toDate)) continue;
    const vendor = r.vendorId ? vendorById.get(r.vendorId) : null;
    const total = round2(Number(r.total));
    const subtotal = round2(Number(r.subtotal));
    const vat = round2(Number(r.vatAmount));
    const expenseLabel = accountLabelById(
      r.accountingAccountId,
      coaById,
      expenseFallbackLabel,
    );
    const bankLabel = paymentSourceLabel(r, bankById, coaById);
    const memo = `Receipt — ${vendor?.name ?? 'unknown'}${
      r.notes ? ` · ${r.notes.slice(0, 80)}` : ''
    }`;

    // VAT split — only when company is VAT-active AND receipt is recoverable.
    const splitVat = input.isVatActive && r.vatRecoverable && vat > 0;
    if (splitVat) {
      // Debit expense (net), debit VAT input, credit bank (gross).
      rows.push({
        date: r.receiptDate,
        memo,
        account: expenseLabel,
        debit: toMoneyString(subtotal),
        credit: '',
        source: 'receipt',
        sourceRefId: r.id,
        reference: vendor?.taxIdLast4 ?? '',
      });
      rows.push({
        date: r.receiptDate,
        memo,
        account: vatInputLabel,
        debit: toMoneyString(vat),
        credit: '',
        source: 'receipt',
        sourceRefId: r.id,
        reference: vendor?.taxIdLast4 ?? '',
      });
      rows.push({
        date: r.receiptDate,
        memo,
        account: bankLabel,
        debit: '',
        credit: toMoneyString(total),
        source: 'receipt',
        sourceRefId: r.id,
        reference: vendor?.taxIdLast4 ?? '',
      });
    } else {
      // No VAT split — debit expense (gross), credit bank (gross). On
      // non-recoverable VAT this baked-in cost is intentional.
      rows.push({
        date: r.receiptDate,
        memo,
        account: expenseLabel,
        debit: toMoneyString(total),
        credit: '',
        source: 'receipt',
        sourceRefId: r.id,
        reference: vendor?.taxIdLast4 ?? '',
      });
      rows.push({
        date: r.receiptDate,
        memo,
        account: bankLabel,
        debit: '',
        credit: toMoneyString(total),
        source: 'receipt',
        sourceRefId: r.id,
        reference: vendor?.taxIdLast4 ?? '',
      });
    }
  }

  // ===== Invoice payments =====
  for (const p of input.invoicePayments) {
    if (!inRange(p.paidDate, input.fromDate, input.toDate)) continue;
    if (p.status !== 'received' && p.status !== 'applied') continue;
    const inv = invoiceById.get(p.invoiceId);
    // Payments tied to voided invoices never reflect cash that hit the bank,
    // so they must not be emitted as journal entries.
    if (inv?.status === 'void') continue;
    const amount = round2(Number(p.amount));
    const bankLabel = p.bankAccount && p.bankAccount.trim() !== ''
      ? `Bank: ${p.bankAccount.trim()}`
      : 'Bank — unspecified';
    const memo = inv
      ? `Invoice payment — ${inv.number}`
      : 'Invoice payment';
    rows.push({
      date: p.paidDate,
      memo,
      account: bankLabel,
      debit: toMoneyString(amount),
      credit: '',
      source: 'invoice_payment',
      sourceRefId: p.id,
      reference: inv?.number ?? '',
    });
    // Cash-basis-friendly credit: revenue. Accountants on accrual will
    // adjust to Accounts Receivable when they import; the memo + reference
    // makes that easy.
    rows.push({
      date: p.paidDate,
      memo,
      account: incomeFallbackLabel,
      debit: '',
      credit: toMoneyString(amount),
      source: 'invoice_payment',
      sourceRefId: p.id,
      reference: inv?.number ?? '',
    });
  }

  // ===== Transfers =====
  // Each transfer match has two rows in transaction_matches (one per side).
  // We dedupe by sorting and only emitting once per (txnA, txnB) pair.
  const seenTransferPairs = new Set<string>();
  for (const m of input.transactionMatches) {
    if (m.matchType !== 'transfer') continue;
    if (m.reversedAt) continue;
    if (!m.transferPairedTxnId) continue;
    const ids = [m.importedTransactionId, m.transferPairedTxnId].sort();
    const key = ids.join('|');
    if (seenTransferPairs.has(key)) continue;
    seenTransferPairs.add(key);

    const txnA = txnById.get(m.importedTransactionId);
    const txnB = txnById.get(m.transferPairedTxnId);
    if (!txnA || !txnB) continue;
    // The "money in" side is the destination. The "money out" side is the source.
    const dest = Number(txnA.amount) > 0 ? txnA : txnB;
    const source = dest === txnA ? txnB : txnA;
    if (!inRange(dest.transactionDate, input.fromDate, input.toDate)) continue;
    const destBank = bankById.get(dest.bankAccountId);
    const sourceBank = bankById.get(source.bankAccountId);
    const destLabel = bankAccountLabel(destBank, coaById);
    const sourceLabel = bankAccountLabel(sourceBank, coaById);
    const amount = round2(Math.abs(Number(dest.amount)));
    const memo = `Transfer ${sourceBank?.name ?? 'source'} → ${
      destBank?.name ?? 'destination'
    }`;
    rows.push({
      date: dest.transactionDate,
      memo,
      account: destLabel,
      debit: toMoneyString(amount),
      credit: '',
      source: 'transfer',
      sourceRefId: dest.id,
      reference: '',
    });
    rows.push({
      date: dest.transactionDate,
      memo,
      account: sourceLabel,
      debit: '',
      credit: toMoneyString(amount),
      source: 'transfer',
      sourceRefId: source.id,
      reference: '',
    });
  }

  // ===== Owner contribution / draw =====
  for (const m of input.transactionMatches) {
    if (m.reversedAt) continue;
    if (m.matchType !== 'owner_contribution' && m.matchType !== 'owner_draw') {
      continue;
    }
    const txn = txnById.get(m.importedTransactionId);
    if (!txn) continue;
    if (!inRange(txn.transactionDate, input.fromDate, input.toDate)) continue;
    const bank = bankById.get(txn.bankAccountId);
    const bankLabel = bankAccountLabel(bank, coaById);
    const amount = round2(Math.abs(Number(txn.amount)));
    const isContribution = m.matchType === 'owner_contribution';
    const memo = isContribution ? 'Owner contribution' : 'Owner draw';
    if (isContribution) {
      rows.push({
        date: txn.transactionDate,
        memo,
        account: bankLabel,
        debit: toMoneyString(amount),
        credit: '',
        source: 'owner_contribution',
        sourceRefId: txn.id,
        reference: '',
      });
      rows.push({
        date: txn.transactionDate,
        memo,
        account: ownerEquityLabel,
        debit: '',
        credit: toMoneyString(amount),
        source: 'owner_contribution',
        sourceRefId: txn.id,
        reference: '',
      });
    } else {
      rows.push({
        date: txn.transactionDate,
        memo,
        account: ownerEquityLabel,
        debit: toMoneyString(amount),
        credit: '',
        source: 'owner_draw',
        sourceRefId: txn.id,
        reference: '',
      });
      rows.push({
        date: txn.transactionDate,
        memo,
        account: bankLabel,
        debit: '',
        credit: toMoneyString(amount),
        source: 'owner_draw',
        sourceRefId: txn.id,
        reference: '',
      });
    }
  }

  // Sort by date ASC, then preserve source emit order (stable).
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}
