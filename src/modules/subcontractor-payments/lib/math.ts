// Pure helpers for sub-payment retainage math. Stored fields are kept in
// sync via the action layer using these.

import { multiply, parseMoney, round2, subtract } from '@/lib/money';

/** Compute retainage_held from gross × percent / 100. */
export function computeRetainageHeld(
  grossAmount: number,
  retainagePercent: number,
): number {
  return multiply(grossAmount, retainagePercent / 100);
}

/** Compute net_paid = gross - retainage_held, never negative. */
export function computeNetPaid(grossAmount: number, retainageHeld: number): number {
  const net = subtract(grossAmount, retainageHeld);
  return net > 0 ? net : 0;
}

/** Parse a money string and round to 2 decimals. */
export function parseMoneySafe(value: string | number | null | undefined): number {
  return parseMoney(value);
}

/** Parse a percent string and round to 2 decimals. */
export function parsePercentSafe(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? round2(n) : 0;
}
