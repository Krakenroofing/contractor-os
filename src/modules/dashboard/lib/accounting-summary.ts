// Lightweight accounting tile aggregator. Read-only; touches no writes.
// Separate from buildDashboardData so a failure here can't break the existing
// dashboard render.

import 'server-only';
import { add, parseMoney, round2, subtract } from '@/lib/money';
import { listImportedTransactions } from '@/lib/data/statement-imports';
import { listReceipts } from '@/lib/data/receipts';
import { listInvoices } from '@/lib/data/invoices';
import { getCompany } from '@/lib/data/companies';

export type AccountingSummary = {
  /** Imported transactions awaiting category (not ignored, no category). */
  uncategorizedCount: number;
  /** Absolute-value $ total of those uncategorized txns. */
  uncategorizedTotal: number;
  /** Draft receipts awaiting Post. */
  unpostedReceiptsCount: number;
  unpostedReceiptsTotal: number;
  /** True for companies where the VAT pane is meaningful. */
  isVatActive: boolean;
  /** Current calendar quarter, e.g. '2026-Q2'. */
  currentQuarterKey: string;
  /** Output VAT (sales) for the current quarter. */
  outputVatThisQuarter: number;
  /** Input VAT (recoverable receipts) for the current quarter. */
  inputVatThisQuarter: number;
  /** Net VAT due for the current quarter (output − input). */
  netVatDueThisQuarter: number;
};

function currentQuarter(asOf: Date): { key: string; year: number; q: number } {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth() + 1;
  const q = Math.min(4, Math.max(1, Math.ceil(month / 3)));
  return { key: `${year}-Q${q}`, year, q };
}

function quarterKeyForDate(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const q = Math.min(4, Math.max(1, Math.ceil(month / 3)));
  return `${year}-Q${q}`;
}

/**
 * Tolerant aggregator. If any subquery fails (e.g. migration not yet applied
 * after a partial deploy), we return zero values so the dashboard doesn't
 * crash. Errors are NOT silently swallowed — they're logged so the operator
 * can spot a misconfiguration in Vercel logs.
 */
export async function buildAccountingSummary(
  companyId: string,
  asOf: Date = new Date(),
): Promise<AccountingSummary> {
  const empty = {
    uncategorizedCount: 0,
    uncategorizedTotal: 0,
    unpostedReceiptsCount: 0,
    unpostedReceiptsTotal: 0,
    isVatActive: false,
    currentQuarterKey: currentQuarter(asOf).key,
    outputVatThisQuarter: 0,
    inputVatThisQuarter: 0,
    netVatDueThisQuarter: 0,
  } satisfies AccountingSummary;

  try {
    const company = await getCompany(companyId);
    const isVatActive = company?.isVatActive ?? false;
    const ratePct = company ? Number(company.vatRatePercent) || 0 : 0;
    const quarter = currentQuarter(asOf);

    const [imports, draftReceipts, invoices, postedReceipts] = await Promise.all([
      listImportedTransactions(companyId, {
        onlyUncategorized: true,
        includeIgnored: false,
        limit: 1000,
      }),
      listReceipts(companyId, { status: 'draft', limit: 500 }),
      listInvoices(companyId),
      isVatActive
        ? listReceipts(companyId, { status: 'posted', limit: 1000 })
        : Promise.resolve([]),
    ]);

    // Uncategorized imported transactions — absolute value summed so debits
    // and credits don't cancel out. Filter to non-reviewed for the operator's
    // "to triage" pile.
    let uncategorizedCount = 0;
    let uncategorizedTotal = 0;
    for (const t of imports) {
      if (t.isReviewed) continue;
      if (t.accountingAccountId) continue;
      uncategorizedCount += 1;
      uncategorizedTotal = add(uncategorizedTotal, Math.abs(parseMoney(t.amount)));
    }

    // Draft receipts.
    const unpostedReceiptsCount = draftReceipts.length;
    const unpostedReceiptsTotal = draftReceipts.reduce(
      (acc, r) => add(acc, parseMoney(r.total)),
      0,
    );

    // VAT — current quarter only.
    let outputVat = 0;
    let inputVat = 0;
    if (isVatActive) {
      for (const inv of invoices) {
        if (inv.status === 'void' || inv.status === 'draft') continue;
        if (quarterKeyForDate(inv.invoiceDate) !== quarter.key) continue;
        outputVat = add(outputVat, round2((parseMoney(inv.subtotal) * ratePct) / 100));
      }
      for (const r of postedReceipts) {
        if (!r.vatRecoverable) continue;
        if (quarterKeyForDate(r.receiptDate) !== quarter.key) continue;
        inputVat = add(inputVat, parseMoney(r.vatAmount));
      }
    }

    return {
      uncategorizedCount,
      uncategorizedTotal: round2(uncategorizedTotal),
      unpostedReceiptsCount,
      unpostedReceiptsTotal: round2(unpostedReceiptsTotal),
      isVatActive,
      currentQuarterKey: quarter.key,
      outputVatThisQuarter: round2(outputVat),
      inputVatThisQuarter: round2(inputVat),
      netVatDueThisQuarter: round2(subtract(outputVat, inputVat)),
    };
  } catch (err) {
    // Tolerant fail — the dashboard must still render. Log so we don't hide
    // a real misconfiguration.
    console.error('buildAccountingSummary failed:', err);
    return empty;
  }
}
