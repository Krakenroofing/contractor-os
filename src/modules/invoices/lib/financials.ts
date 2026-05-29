// Pure invoice financial helpers — no DB / mock-store imports so they're
// safe to run on either side of the dual-backend split.
//
// CONTRACT:
//   - Payment rows are the source of truth.
//   - `invoices.amount_paid` is a denormalized cache: it should always equal
//     `sumAppliedPayments(payments)`. If it ever drifts (a stale row, a
//     manual status flip without a payment, a partial recompute failure),
//     the helpers in this file recompute the truth from payment rows so
//     dashboards / AR never depend on the cache.
//   - Status (`'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void'`)
//     is derived from numbers + dates. Manual `invoices.status` is honoured
//     for `void` and `draft` (which can't be inferred from money) and is
//     used as a hint for `sent`. Everything else is computed.

import type { Invoice, InvoicePayment } from '@/db/schema';
import { add, parseMoney, round2, subtract } from '@/lib/money';

export type InvoiceFinancials = {
  /** Invoice total (after retainage held). */
  total: number;
  /** Sum of payments whose status ∈ {received, applied}. */
  paid: number;
  /** Outstanding balance: max(0, total - paid). Never negative. */
  balance: number;
  /** Retainage currently held (not yet released). */
  retainageHeld: number;
  /** Retainage already released. */
  retainageReleased: number;
};

export type DerivedInvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'void';

/** Sum of payments that count toward the invoice's paid balance. */
export function sumAppliedPayments(payments: InvoicePayment[]): number {
  let total = 0;
  for (const p of payments) {
    if (p.status === 'received' || p.status === 'applied') {
      total = add(total, parseMoney(p.amount));
    }
  }
  return total;
}

/**
 * Compute outstanding balance and other financials directly from payment
 * rows. Does NOT trust `invoice.amount_paid` — that's the denormalized
 * cache that this function exists to bypass.
 */
export function computeInvoiceFinancials(
  invoice: Invoice,
  payments: InvoicePayment[],
): InvoiceFinancials {
  const total = parseMoney(invoice.total);
  const paid = sumAppliedPayments(payments);
  const balance = round2(Math.max(0, subtract(total, paid)));
  return {
    total,
    paid,
    balance,
    retainageHeld: parseMoney(invoice.retainageAmount),
    retainageReleased: parseMoney(invoice.retainageReleased),
  };
}

/**
 * Derive the canonical invoice status from numbers + dates. Honours `void`
 * and `draft` from the stored field (those can't be inferred). Once the
 * invoice is non-draft and non-void, status is computed:
 *   balance ≤ 0  → paid
 *   paid > 0     → partial
 *   dueDate < asOf → overdue
 *   else         → sent
 */
export function deriveInvoiceStatus(
  invoice: Invoice,
  paid: number,
  asOf: Date = new Date(),
): DerivedInvoiceStatus {
  if (invoice.status === 'void') return 'void';
  if (invoice.status === 'draft') return 'draft';
  const total = parseMoney(invoice.total);
  // Allow a tiny epsilon for fractional-cent rounding so 99.995 still clears.
  if (paid >= total - 0.005 && total > 0) return 'paid';
  if (paid > 0) return 'partial';
  if (invoice.dueDate) {
    const due = new Date(`${invoice.dueDate}T00:00:00Z`);
    const today = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    if (due.getTime() < today.getTime()) return 'overdue';
  }
  return 'sent';
}

/**
 * Group payments by invoiceId for fast O(1) lookup. Used by dashboard / AR
 * builders that scan all invoices in one pass.
 */
export function groupPaymentsByInvoice(
  payments: InvoicePayment[],
): Map<string, InvoicePayment[]> {
  const map = new Map<string, InvoicePayment[]>();
  for (const p of payments) {
    const arr = map.get(p.invoiceId);
    if (arr) arr.push(p);
    else map.set(p.invoiceId, [p]);
  }
  return map;
}

/**
 * Net/VAT/Gross decomposition for a single invoice and the cash collected
 * against it. VAT is split proportionally: when an invoice is half-paid,
 * half the VAT has been collected as a liability — the rest is still a
 * receivable. This is the canonical split that every income-showing view
 * should use so that "revenue" never includes VAT we owe the government.
 *
 *   subtotal     = invoice.subtotal (always net, ex-VAT)
 *   taxAmount    = invoice.taxAmount (VAT we'll owe once collected)
 *   total        = invoice.total (gross = subtotal + tax - retainage held)
 *   paidGross    = sum of applied payments
 *   paidVat      = paidGross * (tax / total)      // total is the gross billed
 *   paidNet      = paidGross - paidVat
 *
 * When the invoice has no VAT or zero total the split degrades cleanly to
 * "all net" so dashboards don't divide by zero.
 */
export type InvoiceVatSplit = {
  /** invoice.subtotal (always ex-VAT). */
  net: number;
  /** invoice.taxAmount. */
  vat: number;
  /** invoice.total (gross billed, after retainage held). */
  gross: number;
  /** Sum of applied payments (gross cash received). */
  paidGross: number;
  /** Portion of paidGross that is revenue (net). */
  paidNet: number;
  /** Portion of paidGross that is VAT-collected (a liability). */
  paidVat: number;
  /** Outstanding balance (gross). */
  balanceGross: number;
  /** Outstanding net (revenue not yet realized). */
  balanceNet: number;
  /** Outstanding VAT (not yet collected). */
  balanceVat: number;
};

export function computeInvoiceVatSplit(
  invoice: Invoice,
  payments: InvoicePayment[],
): InvoiceVatSplit {
  const net = parseMoney(invoice.subtotal);
  const vat = parseMoney(invoice.taxAmount);
  const gross = parseMoney(invoice.total);
  const paidGross = sumAppliedPayments(payments);
  // Split a payment by the VAT proportion of the GROSS actually billed
  // (subtotal + vat − retainage held = invoice.total), NOT (net + vat).
  // On retainage invoices (net + vat) inflates the denominator by the
  // retainage, understating VAT-collected and overstating revenue.
  const denom = gross;
  const vatShare = denom > 0 ? vat / denom : 0;
  const paidVat = round2(paidGross * vatShare);
  const paidNet = round2(paidGross - paidVat);
  const balanceGross = round2(Math.max(0, gross - paidGross));
  // The "net side" of what's still owed. Uses the same proportional split
  // so partial payments don't bias toward one side.
  const balanceVat = round2(balanceGross * vatShare);
  const balanceNet = round2(balanceGross - balanceVat);
  return {
    net: round2(net),
    vat: round2(vat),
    gross: round2(gross),
    paidGross: round2(paidGross),
    paidNet,
    paidVat,
    balanceGross,
    balanceNet,
    balanceVat,
  };
}
