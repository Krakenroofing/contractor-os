// Reconciliation matching engine. Pure TS — runs on the server during page
// render against pre-loaded candidate lists, no DB calls here. Returns up to
// `MAX_PER_TYPE` ranked candidates per match type for a given imported
// transaction.
//
// Ranking:
//   exact = amount equal AND date equal
//   high  = amount equal AND |date diff| ≤ 3 days
//   low   = amount equal AND |date diff| ≤ 7 days
//
// Amount equality is strict at the cents level (±$0.01 tolerance handled by
// rounding before comparison). Sign convention: signed `amount` on the bank
// txn — positive credits, negative debits. AR side (invoice payments, owner
// contributions) needs positive bank amount; AP side (receipts, expense
// entries, owner draws) needs negative bank amount.

import { parseMoney, round2 } from '@/lib/money';

export type MatchConfidence = 'exact' | 'high' | 'low';

const HIGH_DAYS = 3;
const LOW_DAYS = 7;
const MAX_PER_TYPE = 5;

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((a - b) / 86_400_000));
}

function confidenceFor(days: number): MatchConfidence | null {
  if (days === 0) return 'exact';
  if (days <= HIGH_DAYS) return 'high';
  if (days <= LOW_DAYS) return 'low';
  return null;
}

function rankWeight(c: MatchConfidence): number {
  return c === 'exact' ? 0 : c === 'high' ? 1 : 2;
}

export type TxnContext = {
  id: string;
  transactionDate: string;
  /** Signed amount: positive = money in (credit), negative = money out (debit). */
  amount: number;
};

// ---------- Candidate sources ----------

export type InvoicePaymentCandidate = {
  id: string;
  invoiceId: string;
  paidDate: string;
  amount: number;
  invoiceNumber: string;
  customerName: string;
};

export type ReceiptCandidate = {
  id: string;
  receiptDate: string;
  amount: number;
  vendorName: string;
  description: string;
};

export type JobCostEntryCandidate = {
  id: string;
  entryDate: string;
  amount: number;
  description: string;
  projectNumber: string | null;
  vendorName: string | null;
};

// ---------- Output shape ----------

export type Match<T> = {
  candidate: T;
  confidence: MatchConfidence;
  dateDelta: number;
};

export type MatchCandidates = {
  invoicePayments: Match<InvoicePaymentCandidate>[];
  receipts: Match<ReceiptCandidate>[];
  jobCostEntries: Match<JobCostEntryCandidate>[];
};

// ---------- Helpers ----------

function sameCents(a: number, b: number): boolean {
  // Both already round2'd by the caller. Compare integer cents to avoid the
  // 0.1 + 0.2 ≠ 0.3 trap.
  return Math.round(a * 100) === Math.round(b * 100);
}

function rankAndCap<T>(
  candidates: Array<Match<T>>,
): Array<Match<T>> {
  return candidates
    .sort((a, b) => {
      const w = rankWeight(a.confidence) - rankWeight(b.confidence);
      if (w !== 0) return w;
      return a.dateDelta - b.dateDelta;
    })
    .slice(0, MAX_PER_TYPE);
}

// ---------- Builders ----------

export function findCandidates(input: {
  txn: TxnContext;
  invoicePayments: InvoicePaymentCandidate[];
  receipts: ReceiptCandidate[];
  jobCostEntries: JobCostEntryCandidate[];
  /** Ids of records already matched (active) — filtered out. */
  takenInvoicePaymentIds: Set<string>;
  takenReceiptIds: Set<string>;
  takenJobCostEntryIds: Set<string>;
}): MatchCandidates {
  const txn = input.txn;
  const txnAmt = round2(txn.amount);
  const moneyIn = txnAmt > 0;
  const moneyOut = txnAmt < 0;
  const absAmt = round2(Math.abs(txnAmt));

  // AR side: invoice payments. Only when bank txn is money-in.
  const ip: Array<Match<InvoicePaymentCandidate>> = [];
  if (moneyIn) {
    for (const c of input.invoicePayments) {
      if (input.takenInvoicePaymentIds.has(c.id)) continue;
      if (!sameCents(round2(c.amount), absAmt)) continue;
      const dd = daysBetween(c.paidDate, txn.transactionDate);
      const conf = confidenceFor(dd);
      if (!conf) continue;
      ip.push({ candidate: c, confidence: conf, dateDelta: dd });
    }
  }

  // AP side: receipts. Receipt.total is positive; bank txn is negative.
  const rc: Array<Match<ReceiptCandidate>> = [];
  if (moneyOut) {
    for (const c of input.receipts) {
      if (input.takenReceiptIds.has(c.id)) continue;
      if (!sameCents(round2(c.amount), absAmt)) continue;
      const dd = daysBetween(c.receiptDate, txn.transactionDate);
      const conf = confidenceFor(dd);
      if (!conf) continue;
      rc.push({ candidate: c, confidence: conf, dateDelta: dd });
    }
  }

  // Catch-all: job_cost_entries. We allow either direction here — vendor
  // expenses are typically money-out, but a job-cost refund could be money-in.
  const jce: Array<Match<JobCostEntryCandidate>> = [];
  for (const c of input.jobCostEntries) {
    if (input.takenJobCostEntryIds.has(c.id)) continue;
    if (!sameCents(round2(c.amount), absAmt)) continue;
    const dd = daysBetween(c.entryDate, txn.transactionDate);
    const conf = confidenceFor(dd);
    if (!conf) continue;
    jce.push({ candidate: c, confidence: conf, dateDelta: dd });
  }

  return {
    invoicePayments: rankAndCap(ip),
    receipts: rankAndCap(rc),
    jobCostEntries: rankAndCap(jce),
  };
}

/** Convert a raw numeric DB column → number. */
export function toAmount(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return round2(v);
  return parseMoney(v);
}

/** Sum of the candidates across all three types — used by the UI to decide
 *  whether to render the panel at all. */
export function hasAnyCandidate(c: MatchCandidates): boolean {
  return (
    c.invoicePayments.length > 0 ||
    c.receipts.length > 0 ||
    c.jobCostEntries.length > 0
  );
}

export function totalCandidates(c: MatchCandidates): number {
  return c.invoicePayments.length + c.receipts.length + c.jobCostEntries.length;
}
