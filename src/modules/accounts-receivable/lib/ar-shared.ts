// Client-safe shared module for the Accounts Receivable / Aging module.
//
// IMPORTANT: This file MUST NOT import 'server-only' or any module that
// transitively imports it (e.g. @/lib/mock-store, anything reading cookies).
// It is consumed by both server pages AND ar-list-client.tsx, so everything
// here has to run in the browser bundle.
//
// Server-only data loaders live in ./ar.ts.

import { add } from '@/lib/money';
import type { Invoice } from '@/db/schema';

// ===== Aging buckets =====

export const AGING_BUCKETS = ['current', 'b1_30', 'b31_60', 'b61_90', 'b90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const BUCKET_LABEL: Record<AgingBucket, string> = {
  current: 'Current',
  b1_30: '1–30 days',
  b31_60: '31–60 days',
  b61_90: '61–90 days',
  b90_plus: '90+ days',
};

export const BUCKET_TONE: Record<AgingBucket, 'green' | 'amber' | 'red' | 'slate'> = {
  current: 'green',
  b1_30: 'amber',
  b31_60: 'amber',
  b61_90: 'red',
  b90_plus: 'red',
};

export function bucketForDaysOverdue(days: number): AgingBucket {
  if (days <= 0) return 'current';
  if (days <= 30) return 'b1_30';
  if (days <= 60) return 'b31_60';
  if (days <= 90) return 'b61_90';
  return 'b90_plus';
}

// ===== Date helpers (UTC-stable) =====

export function parseISODate(d: string): Date {
  // Treat YYYY-MM-DD as a UTC midnight date for stable diffs.
  return new Date(`${d}T00:00:00Z`);
}

export function todayUTC(asOf: Date): Date {
  return new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
}

export function daysBetween(fromISO: string, asOf: Date): number {
  const today = todayUTC(asOf);
  const from = parseISODate(fromISO);
  return Math.floor((today.getTime() - from.getTime()) / 86_400_000);
}

export function isInMonth(iso: string, year: number, month0: number): boolean {
  // month0 = 0–11
  const d = parseISODate(iso);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month0;
}

// ===== Aging row =====

export type AgingRow = {
  invoiceId: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  balance: number;
  /** Outstanding balance attributable to revenue (ex-VAT). */
  balanceNet: number;
  /** Outstanding balance attributable to VAT we'll collect on the
   *  government's behalf — not income. */
  balanceVat: number;
  daysOverdue: number;
  bucket: AgingBucket;
  status: Invoice['status'];
  derivedStatus: Invoice['status'] | 'overdue';
};

// ===== Summary (pure aggregation over AgingRow[]) =====

export type AgingSummary = {
  totalAR: number;
  /** Outstanding revenue (ex-VAT) — the money we'll actually keep. */
  totalARNet: number;
  /** Outstanding VAT — collected later, owed to the government. */
  totalARVat: number;
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
  invoiceCount: number;
  overdueCount: number;
};

export function summarizeAging(rows: AgingRow[]): AgingSummary {
  const summary: AgingSummary = {
    totalAR: 0,
    totalARNet: 0,
    totalARVat: 0,
    current: 0,
    b1_30: 0,
    b31_60: 0,
    b61_90: 0,
    b90_plus: 0,
    invoiceCount: rows.length,
    overdueCount: 0,
  };
  for (const r of rows) {
    summary.totalAR = add(summary.totalAR, r.balance);
    summary.totalARNet = add(summary.totalARNet, r.balanceNet);
    summary.totalARVat = add(summary.totalARVat, r.balanceVat);
    summary[r.bucket] = add(summary[r.bucket], r.balance);
    if (r.daysOverdue > 0) summary.overdueCount += 1;
  }
  return summary;
}

// ===== Display helpers (no I/O) =====

export function formatMonthYear(asOf: Date = new Date()): string {
  return asOf.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
