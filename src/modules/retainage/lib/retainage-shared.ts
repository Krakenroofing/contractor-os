// Client-safe shared module for the Retainage module.
//
// IMPORTANT: This file MUST NOT import 'server-only' or any module that
// transitively imports it (e.g. @/lib/mock-store, anything reading cookies).
// It is consumed by both server pages AND the retainage-list-client.tsx
// client component, so everything here has to run in the browser bundle.
//
// Server-only data loaders live in ./retainage.ts.

import { add, round2, subtract } from '@/lib/money';
import type { RetainageRelease } from '@/db/schema';

// ===== Status =====

export const RETAINAGE_STATUSES = [
  'held',
  'partially_released',
  'released',
  'overdue',
] as const;
export type RetainageStatus = (typeof RETAINAGE_STATUSES)[number];

export const STATUS_LABEL: Record<RetainageStatus, string> = {
  held: 'Held',
  partially_released: 'Partially released',
  released: 'Released',
  overdue: 'Overdue',
};

export const STATUS_TONE: Record<RetainageStatus, 'slate' | 'blue' | 'green' | 'amber' | 'red'> = {
  held: 'blue',
  partially_released: 'amber',
  released: 'green',
  overdue: 'red',
};

// ===== Date helpers (UTC-stable, no Intl/locale dependencies) =====

function parseISODate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

function todayUTC(asOf: Date): Date {
  return new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
}

export function daysBetween(fromISO: string, asOf: Date): number {
  const today = todayUTC(asOf);
  const from = parseISODate(fromISO);
  return Math.floor((today.getTime() - from.getTime()) / 86_400_000);
}

// ===== Status derivation (pure) =====

export function deriveRetainageStatus(input: {
  retainageAmount: number;
  retainageReleased: number;
  expectedReleaseDate: string | null;
  asOf: Date;
}): RetainageStatus {
  const balance = subtract(input.retainageAmount, input.retainageReleased);
  if (input.retainageAmount <= 0) return 'released';
  if (balance <= 0) return 'released';
  if (input.retainageReleased > 0) return 'partially_released';
  // No releases yet
  if (input.expectedReleaseDate) {
    const days = daysBetween(input.expectedReleaseDate, input.asOf);
    if (days > 0) return 'overdue';
  }
  return 'held';
}

// ===== Row =====

export type RetainageRow = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  contractValue: number;
  totalInvoiced: number;
  retainagePercent: number;
  retainageHeld: number;
  retainageReleased: number;
  retainageBalance: number;
  expectedReleaseDate: string | null;
  daysUntilRelease: number | null;
  status: RetainageStatus;
  releaseCount: number;
};

// ===== Summary (pure aggregation over RetainageRow[]) =====

export type RetainageSummary = {
  invoiceCount: number;
  totalHeld: number;
  totalReleased: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
};

export function summarizeRetainage(rows: RetainageRow[]): RetainageSummary {
  const summary: RetainageSummary = {
    invoiceCount: rows.length,
    totalHeld: 0,
    totalReleased: 0,
    outstanding: 0,
    overdue: 0,
    overdueCount: 0,
  };
  for (const r of rows) {
    summary.totalHeld = add(summary.totalHeld, r.retainageHeld);
    summary.totalReleased = add(summary.totalReleased, r.retainageReleased);
    summary.outstanding = add(summary.outstanding, r.retainageBalance);
    if (r.status === 'overdue') {
      summary.overdue = add(summary.overdue, r.retainageBalance);
      summary.overdueCount += 1;
    }
  }
  return summary;
}

// ===== Activity (recent releases) — type only =====

export type RetainageReleaseActivity = RetainageRelease & {
  invoiceNumber: string;
  projectName: string;
  customerName: string;
};

// ===== Math helper for the form preview =====

export function calcRetainageOnInvoice(input: {
  subtotal: number;
  retainagePercent: number;
}) {
  const retainageHeld = round2(
    (input.subtotal * input.retainagePercent) / 100,
  );
  return { retainageHeld };
}

// ===== Sort helper used by the dashboard server page =====

export function compareRetainageRows(a: RetainageRow, b: RetainageRow): number {
  const order: Record<RetainageStatus, number> = {
    overdue: 0,
    held: 1,
    partially_released: 2,
    released: 3,
  };
  const cmp = order[a.status] - order[b.status];
  if (cmp !== 0) return cmp;
  return b.retainageBalance - a.retainageBalance;
}
