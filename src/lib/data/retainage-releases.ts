// Async data accessor for retainage releases.
//
// Each release row is a partial pay-out of the retainage held on its parent
// invoice. The invoice's `retainageReleased` column is recomputed as
// SUM(retainage_releases.amount) after every create. Same logic, two
// backends.

import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import {
  invoices,
  retainageReleases,
  type RetainageRelease,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockRetainageReleases as mockList,
  getMockRetainageRelease as mockGet,
  listRetainageReleasesForInvoice as mockListForInvoice,
  listRetainageReleasesForProject as mockListForProject,
  createMockRetainageRelease as mockCreate,
  recomputeInvoiceRetainageStateInMemory,
  DuplicateRetainageReleaseNumberError,
  RetainageOverReleaseError,
  type CreateRetainageReleaseInput,
} from '@/lib/mock-store';

export { DuplicateRetainageReleaseNumberError, RetainageOverReleaseError };
export type { CreateRetainageReleaseInput };

export async function listRetainageReleases(
  companyId: string,
): Promise<RetainageRelease[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(retainageReleases)
      .where(eq(retainageReleases.companyId, companyId))
      .orderBy(desc(retainageReleases.releaseDate));
  }
  return mockList(companyId);
}

export async function getRetainageRelease(
  companyId: string,
  id: string,
): Promise<RetainageRelease | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(retainageReleases)
      .where(
        and(
          eq(retainageReleases.id, id),
          eq(retainageReleases.companyId, companyId),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function listRetainageReleasesForInvoice(
  invoiceId: string,
): Promise<RetainageRelease[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(retainageReleases)
      .where(eq(retainageReleases.invoiceId, invoiceId))
      .orderBy(retainageReleases.releaseDate);
  }
  return mockListForInvoice(invoiceId);
}

export async function listRetainageReleasesForProject(
  projectId: string,
): Promise<RetainageRelease[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(retainageReleases)
      .where(eq(retainageReleases.projectId, projectId))
      .orderBy(retainageReleases.releaseDate);
  }
  return mockListForProject(projectId);
}

/**
 * Recompute invoice.retainageReleased from the persisted retainage_releases
 * rows. Mirrors the in-memory logic.
 */
export async function recomputeInvoiceRetainageState(
  invoiceId: string,
): Promise<void> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const releases = await db
      .select()
      .from(retainageReleases)
      .where(eq(retainageReleases.invoiceId, invoiceId));
    const released = releases.reduce((acc, r) => acc + Number(r.amount), 0);
    await db
      .update(invoices)
      .set({ retainageReleased: released.toFixed(2), updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    return;
  }
  recomputeInvoiceRetainageStateInMemory(invoiceId);
}

export async function createRetainageRelease(
  companyId: string,
  input: CreateRetainageReleaseInput,
): Promise<RetainageRelease> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Verify invoice belongs to active company.
    const invRows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);
    if (invRows.length === 0) {
      throw new Error('Invoice not found in active company');
    }
    const inv = invRows[0];

    if (input.releaseNumber !== '') {
      const dup = await db
        .select({ id: retainageReleases.id })
        .from(retainageReleases)
        .where(
          and(
            eq(retainageReleases.companyId, companyId),
            eq(retainageReleases.releaseNumber, input.releaseNumber),
          ),
        )
        .limit(1);
      if (dup.length > 0) throw new DuplicateRetainageReleaseNumberError();
    }

    const heldAmount = Number(inv.retainageAmount);
    const alreadyReleased = Number(inv.retainageReleased);
    const incoming = Number(input.amount);
    const balance = heldAmount - alreadyReleased;
    if (incoming > balance + 0.005) {
      throw new RetainageOverReleaseError(
        `Cannot release ${input.amount}; only ${balance.toFixed(2)} of retainage remains held.`,
      );
    }

    const inserted = await db
      .insert(retainageReleases)
      .values({
        companyId,
        invoiceId: input.invoiceId,
        projectId: inv.projectId,
        paymentId: input.paymentId,
        releaseNumber: input.releaseNumber,
        releaseDate: input.releaseDate,
        amount: input.amount,
        vatRate: input.vatRate ?? '0',
        vatAmount: input.vatAmount ?? '0',
        notes: input.notes,
      })
      .returning();
    await recomputeInvoiceRetainageState(input.invoiceId);
    return inserted[0];
  }
  return mockCreate(companyId, input);
}
