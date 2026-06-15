import 'server-only';
import type {
  BankAccount,
  ImportedTransaction,
  ImportedTransactionLine,
  Invoice,
  InvoicePayment,
} from '@/db/schema';
import {
  insertAccountingAccount,
  listAccountingAccounts,
} from '@/lib/data/accounting-accounts';
import { listInvoices } from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import {
  listImportedTransactions,
  listLinesForTransactionIds,
} from '@/lib/data/statement-imports';
import { listActiveMatchesForCompany } from '@/lib/data/transaction-matches';
import {
  deleteJournalEntriesForSource,
  postJournalEntry,
  type JournalLineInput,
} from '@/lib/data/general-ledger';

// Phase 3.2: translate invoices + payments into balanced journal entries.
//
// Posting rules (confirmed with Chris, 2026-06-15) — billed basis, base vs CO
// to separate revenue accounts:
//   Invoice sent:  Dr AR (total) + Dr Retainage Receivable (retainage)
//                  Cr Revenue (subtotal, net) + Cr VAT Payable (tax)
//     (total = subtotal + tax − retainage, verified against the data)
//     revenue account: CO invoices → Change Order Revenue; base invoices →
//     the invoice's revenue category, else the default income account.
//   Payment:       Dr Undeposited Funds (amount) / Cr AR
//     (cash sits in Undeposited Funds until the bank deposit posts in 3.3 —
//      avoids double-counting cash with bank transactions.)

export type GlSystemAccounts = {
  ar: string;
  undepositedFunds: string;
  retainageReceivable: string;
  vatPayable: string;
  changeOrderRevenue: string;
  defaultRevenue: string;
  openingEquity: string;
  uncatIncome: string;
  uncatExpense: string;
};

/** Find-or-create the system accounts the invoice/payment postings need. */
export async function resolveGlSystemAccounts(
  companyId: string,
): Promise<GlSystemAccounts> {
  const accounts = await listAccountingAccounts(companyId);
  const active = () => accounts.filter((a) => !a.isArchived);
  const byType = (t: string) => active().find((a) => a.type === t);
  const byName = (n: string) =>
    active().find((a) => a.name.trim().toLowerCase() === n.toLowerCase());

  async function ensure(
    find: () => { id: string } | undefined,
    create: Parameters<typeof insertAccountingAccount>[1],
  ): Promise<string> {
    const found = find();
    if (found) return found.id;
    const made = await insertAccountingAccount(companyId, create);
    accounts.push(made);
    return made.id;
  }

  const ar = await ensure(() => byName('Accounts Receivable'), {
    name: 'Accounts Receivable',
    type: 'asset',
    rollupGroup: 'asset',
    parentId: null,
  });
  const undepositedFunds = await ensure(() => byName('Undeposited Funds'), {
    name: 'Undeposited Funds',
    type: 'asset',
    rollupGroup: 'asset',
    parentId: null,
  });
  const retainageReceivable = await ensure(
    () => byName('Retainage Receivable'),
    {
      name: 'Retainage Receivable',
      type: 'asset',
      rollupGroup: 'asset',
      parentId: null,
    },
  );
  const vatPayable = await ensure(() => byType('vat_payable'), {
    name: 'VAT Payable',
    type: 'vat_payable',
    rollupGroup: 'vat_tax',
    parentId: null,
  });
  const changeOrderRevenue = await ensure(() => byName('Change Order Revenue'), {
    name: 'Change Order Revenue',
    type: 'income',
    rollupGroup: 'income',
    parentId: null,
  });
  const defaultRevenue = await ensure(
    () => byType('uncategorized_income') ?? byName('Sales / Income'),
    {
      name: 'Sales / Income',
      type: 'income',
      rollupGroup: 'income',
      parentId: null,
    },
  );

  const openingEquity = await ensure(() => byName('Opening Balance Equity'), {
    name: 'Opening Balance Equity',
    type: 'equity',
    rollupGroup: 'equity',
    parentId: null,
  });
  const uncatIncome = await ensure(() => byType('uncategorized_income'), {
    name: 'Uncategorized Income',
    type: 'uncategorized_income',
    rollupGroup: 'income',
    parentId: null,
  });
  const uncatExpense = await ensure(() => byType('uncategorized_expense'), {
    name: 'Uncategorized Expense',
    type: 'uncategorized_expense',
    rollupGroup: 'opex',
    parentId: null,
  });

  return {
    ar,
    undepositedFunds,
    retainageReceivable,
    vatPayable,
    changeOrderRevenue,
    defaultRevenue,
    openingEquity,
    uncatIncome,
    uncatExpense,
  };
}

function invoiceLines(
  invoice: Invoice,
  accounts: GlSystemAccounts,
): JournalLineInput[] {
  const subtotal = Number(invoice.subtotal);
  const tax = Number(invoice.taxAmount);
  const retainage = Number(invoice.retainageAmount);
  const total = Number(invoice.total);

  // Base vs CO separation: CO invoices credit Change Order Revenue; base
  // invoices credit their service-line category, else the default income line.
  const revenueAccount = invoice.changeOrderId
    ? accounts.changeOrderRevenue
    : (invoice.accountingAccountId ?? accounts.defaultRevenue);

  const lines: JournalLineInput[] = [];
  if (total > 0) {
    lines.push({
      accountId: accounts.ar,
      debit: total,
      credit: 0,
      projectId: invoice.projectId,
    });
  }
  if (retainage > 0) {
    lines.push({
      accountId: accounts.retainageReceivable,
      debit: retainage,
      credit: 0,
      projectId: invoice.projectId,
    });
  }
  if (subtotal > 0) {
    lines.push({
      accountId: revenueAccount,
      debit: 0,
      credit: subtotal,
      projectId: invoice.projectId,
    });
  }
  if (tax > 0) {
    lines.push({ accountId: accounts.vatPayable, debit: 0, credit: tax });
  }
  return lines;
}

/** (Re)post the journal entry for one invoice. Idempotent — clears any prior
 *  entry for this invoice first. */
export async function postInvoiceToGl(
  companyId: string,
  invoice: Invoice,
  accounts: GlSystemAccounts,
): Promise<boolean> {
  await deleteJournalEntriesForSource(companyId, 'invoice', invoice.id);
  const lines = invoiceLines(invoice, accounts);
  if (lines.length < 2) return false;
  await postJournalEntry(companyId, {
    entryDate: invoice.invoiceDate,
    memo: `Invoice ${invoice.number}`,
    sourceType: 'invoice',
    sourceId: invoice.id,
    lines,
  });
  return true;
}

/** (Re)post the journal entry for one payment. Only counted statuses post. */
export async function postPaymentToGl(
  companyId: string,
  payment: InvoicePayment,
  accounts: GlSystemAccounts,
): Promise<boolean> {
  await deleteJournalEntriesForSource(companyId, 'payment', payment.id);
  if (payment.status !== 'received' && payment.status !== 'applied') {
    return false;
  }
  const amount = Number(payment.amount);
  if (!(amount > 0)) return false;
  await postJournalEntry(companyId, {
    entryDate: payment.paidDate,
    memo: `Payment ${payment.paymentNumber || ''}`.trim(),
    sourceType: 'payment',
    sourceId: payment.id,
    lines: [
      { accountId: accounts.undepositedFunds, debit: amount, credit: 0 },
      { accountId: accounts.ar, debit: 0, credit: amount },
    ],
  });
  return true;
}

/** Opening balance for a bank/credit-card account: Dr Cash / Cr Opening
 *  Balance Equity (reversed for a negative/overdraft/CC opening). */
export async function postBankOpeningToGl(
  companyId: string,
  bank: BankAccount,
  accounts: GlSystemAccounts,
): Promise<boolean> {
  await deleteJournalEntriesForSource(companyId, 'opening', bank.id);
  const opening = Number(bank.openingBalance);
  if (!opening || !bank.accountingAccountId || !bank.openingDate) return false;
  const abs = Math.abs(opening);
  const lines: JournalLineInput[] =
    opening > 0
      ? [
          { accountId: bank.accountingAccountId, debit: abs, credit: 0 },
          { accountId: accounts.openingEquity, debit: 0, credit: abs },
        ]
      : [
          { accountId: accounts.openingEquity, debit: abs, credit: 0 },
          { accountId: bank.accountingAccountId, debit: 0, credit: abs },
        ];
  await postJournalEntry(companyId, {
    entryDate: bank.openingDate,
    memo: `Opening balance — ${bank.name}`,
    sourceType: 'opening',
    sourceId: bank.id,
    lines,
  });
  return true;
}

/**
 * Post one bank transaction's cash movement. The bank side always posts (cash
 * is real regardless of categorization); the other side is:
 *   - matched to an invoice payment → Undeposited Funds (clears the parking
 *     account the payment posted to — no double-count of revenue/cash),
 *   - split → each line to its category,
 *   - single category → that account,
 *   - uncategorized → Uncategorized Income/Expense suspense.
 * (Transfers net out through suspense; owner draw/contribution are categorized
 *  to owner-equity on the txn so they post there.)
 */
export async function postBankTxnToGl(
  companyId: string,
  txn: ImportedTransaction,
  splitLines: ImportedTransactionLine[],
  matchType: string | undefined,
  bankAccountId: string | null | undefined,
  accounts: GlSystemAccounts,
): Promise<boolean> {
  await deleteJournalEntriesForSource(companyId, 'bank', txn.id);
  if (txn.isIgnored || !bankAccountId) return false;
  const amount = Number(txn.amount);
  const abs = Math.round(Math.abs(amount) * 100) / 100;
  if (abs === 0) return false;
  const isDeposit = amount > 0;

  const lines: JournalLineInput[] = [
    isDeposit
      ? { accountId: bankAccountId, debit: abs, credit: 0 }
      : { accountId: bankAccountId, debit: 0, credit: abs },
  ];

  if (matchType === 'invoice_payment') {
    lines.push(
      isDeposit
        ? { accountId: accounts.undepositedFunds, debit: 0, credit: abs }
        : { accountId: accounts.undepositedFunds, debit: abs, credit: 0 },
    );
  } else if (splitLines.length > 0) {
    for (const l of splitLines) {
      const amt = Math.round(Math.abs(Number(l.amount)) * 100) / 100;
      if (amt <= 0) continue;
      const acct =
        l.accountingAccountId ??
        (isDeposit ? accounts.uncatIncome : accounts.uncatExpense);
      lines.push(
        isDeposit
          ? { accountId: acct, debit: 0, credit: amt, projectId: l.projectId }
          : { accountId: acct, debit: amt, credit: 0, projectId: l.projectId },
      );
    }
  } else {
    const acct =
      txn.accountingAccountId ??
      (isDeposit ? accounts.uncatIncome : accounts.uncatExpense);
    lines.push(
      isDeposit
        ? { accountId: acct, debit: 0, credit: abs, projectId: txn.projectId }
        : { accountId: acct, debit: abs, credit: 0, projectId: txn.projectId },
    );
  }

  await postJournalEntry(companyId, {
    entryDate: txn.transactionDate,
    memo: `Bank — ${(txn.description ?? '').slice(0, 180)}`,
    sourceType: 'bank',
    sourceId: txn.id,
    lines,
  });
  return true;
}

export type RebuildGlResult = {
  postedInvoices: number;
  postedPayments: number;
  postedBankTxns: number;
  postedOpenings: number;
  failures: string[];
};

/** Backfill / resync the GL from all non-void invoices + their payments.
 *  Idempotent (each invoice/payment clears its prior entry before re-posting),
 *  so it's safe to re-run whenever invoices change. */
export async function rebuildGlFromInvoicesAndPayments(
  companyId: string,
): Promise<RebuildGlResult> {
  const accounts = await resolveGlSystemAccounts(companyId);
  const allInvoices = await listInvoices(companyId);
  const invoices = allInvoices.filter(
    (i) => i.status !== 'draft' && i.status !== 'void',
  );
  const liveInvoiceIds = new Set(invoices.map((i) => i.id));
  const payments = (await listPayments(companyId)).filter((p) =>
    liveInvoiceIds.has(p.invoiceId),
  );

  const failures: string[] = [];
  let postedInvoices = 0;
  let postedPayments = 0;
  let postedBankTxns = 0;
  let postedOpenings = 0;

  for (const inv of invoices) {
    try {
      if (await postInvoiceToGl(companyId, inv, accounts)) postedInvoices++;
    } catch (err) {
      failures.push(
        `Invoice ${inv.number}: ${err instanceof Error ? err.message : 'failed'}`,
      );
    }
  }
  for (const p of payments) {
    try {
      if (await postPaymentToGl(companyId, p, accounts)) postedPayments++;
    } catch (err) {
      failures.push(
        `Payment ${p.paymentNumber || p.id}: ${err instanceof Error ? err.message : 'failed'}`,
      );
    }
  }

  // ----- Cash + expense side: bank opening balances + transactions -----
  const banks = await listBankAccounts(companyId);
  const bankAcctById = new Map(
    banks.map((b) => [b.id, b.accountingAccountId]),
  );
  for (const b of banks) {
    try {
      if (await postBankOpeningToGl(companyId, b, accounts)) postedOpenings++;
    } catch (err) {
      failures.push(
        `Opening ${b.name}: ${err instanceof Error ? err.message : 'failed'}`,
      );
    }
  }

  const txns = await listImportedTransactions(companyId, {
    includeIgnored: false,
    limit: 5000,
  });
  const splitLines = await listLinesForTransactionIds(
    companyId,
    txns.map((t) => t.id),
  );
  const linesByTxn = new Map<string, ImportedTransactionLine[]>();
  for (const l of splitLines) {
    const arr = linesByTxn.get(l.importedTransactionId) ?? [];
    arr.push(l);
    linesByTxn.set(l.importedTransactionId, arr);
  }
  const matches = await listActiveMatchesForCompany(companyId);
  const matchByTxn = new Map(
    matches.map((m) => [m.importedTransactionId, m.matchType]),
  );

  for (const t of txns) {
    try {
      const did = await postBankTxnToGl(
        companyId,
        t,
        linesByTxn.get(t.id) ?? [],
        matchByTxn.get(t.id),
        bankAcctById.get(t.bankAccountId),
        accounts,
      );
      if (did) postedBankTxns++;
    } catch (err) {
      failures.push(
        `Bank txn ${t.id.slice(0, 8)}: ${err instanceof Error ? err.message : 'failed'}`,
      );
    }
  }

  return {
    postedInvoices,
    postedPayments,
    postedBankTxns,
    postedOpenings,
    failures,
  };
}
