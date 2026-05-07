// Server-only data loaders for the Accounts Receivable / Aging module.
//
// This file imports the in-memory mock store and is therefore unsafe to import
// from any client component. Pure types, bucket enums, and pure aggregation
// helpers live in ./ar-shared.ts and are safe for both sides.

import 'server-only';
import { listInvoices } from '@/lib/data/invoices';
import { listInvoicePaymentsForCompany } from '@/lib/data/invoice-payments';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { add, parseMoney, round2 } from '@/lib/money';
import type { Invoice, InvoicePayment } from '@/db/schema';
import {
  computeInvoiceFinancials,
  deriveInvoiceStatus,
  groupPaymentsByInvoice,
} from '@/modules/invoices/lib/financials';
import {
  bucketForDaysOverdue,
  daysBetween,
  isInMonth,
  type AgingRow,
} from './ar-shared';

// Re-export the client-safe surface so existing server callers that imported
// from '@/modules/accounts-receivable/lib/ar' keep working unchanged.
export {
  AGING_BUCKETS,
  BUCKET_LABEL,
  BUCKET_TONE,
  bucketForDaysOverdue,
  daysBetween,
  isInMonth,
  parseISODate,
  todayUTC,
  summarizeAging,
  formatMonthYear,
  type AgingBucket,
  type AgingRow,
  type AgingSummary,
} from './ar-shared';

// ===== Aging row builder (server-only — reads mock store) =====

async function buildAgingRow(
  companyId: string,
  inv: Invoice,
  payments: InvoicePayment[],
  asOf: Date,
): Promise<AgingRow | null> {
  if (inv.status === 'void') return null;
  // Balance is computed from payment rows directly — never trust
  // `inv.amount_paid` here because a manual "Mark Paid" status flip can
  // leave the cache stale until the next recompute.
  const fin = computeInvoiceFinancials(inv, payments);
  if (fin.balance <= 0) return null;

  const project = await getProject(companyId, inv.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;

  const daysOverdue = inv.dueDate ? daysBetween(inv.dueDate, asOf) : 0;
  const bucket = bucketForDaysOverdue(daysOverdue);
  // Derived status uses the canonical helper so AR list and the dashboard
  // agree on what "paid" / "partial" / "overdue" mean.
  const derivedStatus = deriveInvoiceStatus(inv, fin.paid, asOf);

  return {
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    projectId: inv.projectId,
    projectName: project?.name ?? 'Unknown project',
    customerId: project?.customerId ?? '',
    customerName: customer?.name ?? 'Unknown customer',
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    total: fin.total,
    amountPaid: fin.paid,
    balance: fin.balance,
    daysOverdue,
    bucket,
    status: inv.status,
    derivedStatus,
  };
}

export async function buildAgingRowsForCompany(
  companyId: string,
  asOf: Date = new Date(),
): Promise<AgingRow[]> {
  const invoices = await listInvoices(companyId);
  const allPayments = await listInvoicePaymentsForCompany(companyId);
  const paymentsByInvoice = groupPaymentsByInvoice(allPayments);
  const rows = await Promise.all(
    invoices.map((inv) =>
      buildAgingRow(companyId, inv, paymentsByInvoice.get(inv.id) ?? [], asOf),
    ),
  );
  return rows
    .filter((r): r is AgingRow => r !== null)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

// ===== Cash collected this month (server-only — reads payments) =====

export async function calcCashCollectedThisMonth(
  companyId: string,
  asOf: Date = new Date(),
): Promise<number> {
  const payments: InvoicePayment[] = await listInvoicePaymentsForCompany(companyId);
  // Pull invoice statuses so we can exclude payments tied to voided invoices.
  // The user-visible contract is "voided invoices don't count toward any
  // dashboard metric, including cash" — see the void/delete spec.
  const invoiceList = await listInvoices(companyId);
  const voidedInvoiceIds = new Set(
    invoiceList.filter((i) => i.status === 'void').map((i) => i.id),
  );
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  let total = 0;
  for (const p of payments) {
    if (voidedInvoiceIds.has(p.invoiceId)) continue;
    if (p.status !== 'received' && p.status !== 'applied') continue;
    if (isInMonth(p.paidDate, year, month)) {
      total = add(total, parseMoney(p.amount));
    }
  }
  return round2(total);
}
