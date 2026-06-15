import 'server-only';
import type { Invoice, InvoicePayment } from '@/db/schema';
import {
  insertAccountingAccount,
  listAccountingAccounts,
} from '@/lib/data/accounting-accounts';
import { listInvoices } from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
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

  return {
    ar,
    undepositedFunds,
    retainageReceivable,
    vatPayable,
    changeOrderRevenue,
    defaultRevenue,
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

export type RebuildGlResult = {
  postedInvoices: number;
  postedPayments: number;
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

  return { postedInvoices, postedPayments, failures };
}
