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
import { add, parseMoney, round2, subtract } from '@/lib/money';
import type { Invoice, InvoicePayment } from '@/db/schema';
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
  asOf: Date,
): Promise<AgingRow | null> {
  if (inv.status === 'void' || inv.status === 'paid') return null;
  const total = parseMoney(inv.total);
  const paid = parseMoney(inv.amountPaid);
  const balance = subtract(total, paid);
  if (balance <= 0) return null;

  const project = await getProject(companyId, inv.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;

  const daysOverdue = inv.dueDate ? daysBetween(inv.dueDate, asOf) : 0;
  const bucket = bucketForDaysOverdue(daysOverdue);
  const derivedStatus =
    inv.status === 'sent' && daysOverdue > 0 ? 'overdue' : inv.status;

  return {
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    projectId: inv.projectId,
    projectName: project?.name ?? 'Unknown project',
    customerId: project?.customerId ?? '',
    customerName: customer?.name ?? 'Unknown customer',
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    total,
    amountPaid: paid,
    balance,
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
  const rows = await Promise.all(
    invoices.map((inv) => buildAgingRow(companyId, inv, asOf)),
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
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  let total = 0;
  for (const p of payments) {
    if (isInMonth(p.paidDate, year, month)) {
      total = add(total, parseMoney(p.amount));
    }
  }
  return round2(total);
}
