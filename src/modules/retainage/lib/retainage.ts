// Server-only data loaders for the Retainage module.
//
// This file imports the in-memory mock store and is therefore unsafe to import
// from any client component. Pure types, status enums, and pure calculation
// helpers live in ./retainage-shared.ts and are safe for both sides.

import 'server-only';
import { listInvoices } from '@/lib/data/invoices';
import {
  listRetainageReleases,
  listRetainageReleasesForInvoice,
} from '@/lib/data/retainage-releases';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { parseMoney, subtract } from '@/lib/money';
import type { Invoice } from '@/db/schema';
import {
  compareRetainageRows,
  daysBetween,
  deriveRetainageStatus,
  type RetainageReleaseActivity,
  type RetainageRow,
} from './retainage-shared';

// Re-export the client-safe surface so existing server callers that imported
// from '@/modules/retainage/lib/retainage' keep working unchanged.
export {
  RETAINAGE_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  deriveRetainageStatus,
  summarizeRetainage,
  calcRetainageOnInvoice,
  compareRetainageRows,
  type RetainageStatus,
  type RetainageRow,
  type RetainageSummary,
  type RetainageReleaseActivity,
} from './retainage-shared';

// ===== Row builder (server-only — reads mock store) =====

async function buildRetainageRow(
  companyId: string,
  inv: Invoice,
  asOf: Date,
): Promise<RetainageRow | null> {
  const retainageAmount = parseMoney(inv.retainageAmount);
  const retainageReleased = parseMoney(inv.retainageReleased);
  // Skip invoices that never had retainage AND have no release activity.
  if (retainageAmount <= 0 && retainageReleased <= 0) return null;
  if (inv.status === 'void') return null;

  const project = await getProject(companyId, inv.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;

  const releases = await listRetainageReleasesForInvoice(inv.id);

  const status = deriveRetainageStatus({
    retainageAmount,
    retainageReleased,
    expectedReleaseDate: inv.expectedRetainageReleaseDate,
    asOf,
  });

  const daysUntilRelease = inv.expectedRetainageReleaseDate
    ? -daysBetween(inv.expectedRetainageReleaseDate, asOf)
    : null;

  return {
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    invoiceDate: inv.invoiceDate,
    projectId: inv.projectId,
    projectName: project?.name ?? 'Unknown project',
    customerId: project?.customerId ?? '',
    customerName: customer?.name ?? 'Unknown customer',
    contractValue: project ? parseMoney(project.contractValue) : 0,
    totalInvoiced: parseMoney(inv.total) + retainageAmount,
    retainagePercent: Number(inv.retainagePercent),
    retainageHeld: retainageAmount,
    retainageReleased,
    retainageBalance: subtract(retainageAmount, retainageReleased),
    expectedReleaseDate: inv.expectedRetainageReleaseDate,
    daysUntilRelease,
    status,
    releaseCount: releases.length,
  };
}

export async function buildRetainageRowsForCompany(
  companyId: string,
  asOf: Date = new Date(),
): Promise<RetainageRow[]> {
  const invoices = await listInvoices(companyId);
  const rows = await Promise.all(
    invoices.map((inv) => buildRetainageRow(companyId, inv, asOf)),
  );
  return rows
    .filter((r): r is RetainageRow => r !== null)
    .sort(compareRetainageRows);
}

// ===== Recent releases activity feed (server-only) =====

export async function listRecentRetainageReleases(
  companyId: string,
  limit = 10,
): Promise<RetainageReleaseActivity[]> {
  const releases = await listRetainageReleases(companyId);
  const invs = await listInvoices(companyId);
  return await Promise.all(
    releases.slice(0, limit).map(async (r) => {
      const project = await getProject(companyId, r.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      const inv = invs.find((i) => i.id === r.invoiceId);
      return {
        ...r,
        invoiceNumber: inv?.number ?? '—',
        projectName: project?.name ?? 'Unknown project',
        customerName: customer?.name ?? 'Unknown customer',
      };
    }),
  );
}
