// Dual-backend data accessor for subcontractor payments.

import 'server-only';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import {
  subcontractorPayments,
  type SubcontractorPayment,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockSubcontractorPayments as mockList,
  getMockSubcontractorPayment as mockGet,
  createMockSubcontractorPayment as mockCreate,
  updateMockSubcontractorPayment as mockUpdate,
  deleteMockSubcontractorPayment as mockDelete,
  type CreateSubcontractorPaymentInput,
} from '@/lib/mock-store';

export type { CreateSubcontractorPaymentInput };
export type SubcontractorPaymentFilters = {
  vendorId?: string;
  projectId?: string;
  status?: string;
  /** Inclusive overlap range. Both must be set or neither — passing one
   *  alone is ignored. */
  overlapsStart?: string;
  overlapsEnd?: string;
};

export async function listSubcontractorPayments(
  companyId: string,
  filters: SubcontractorPaymentFilters = {},
): Promise<SubcontractorPayment[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const conds = [eq(subcontractorPayments.companyId, companyId)];
    if (filters.vendorId)
      conds.push(eq(subcontractorPayments.vendorId, filters.vendorId));
    if (filters.projectId)
      conds.push(eq(subcontractorPayments.projectId, filters.projectId));
    if (filters.status)
      conds.push(eq(subcontractorPayments.status, filters.status));
    // Overlap test: period.end >= range.start AND period.start <= range.end.
    if (filters.overlapsStart && filters.overlapsEnd) {
      conds.push(
        gte(subcontractorPayments.workPeriodEnd, filters.overlapsStart),
      );
      conds.push(
        lte(subcontractorPayments.workPeriodStart, filters.overlapsEnd),
      );
    }
    return await db
      .select()
      .from(subcontractorPayments)
      .where(and(...conds))
      .orderBy(desc(subcontractorPayments.workPeriodStart));
  }
  return mockList(companyId, filters);
}

export async function getSubcontractorPayment(
  companyId: string,
  id: string,
): Promise<SubcontractorPayment | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(subcontractorPayments)
      .where(
        and(
          eq(subcontractorPayments.id, id),
          eq(subcontractorPayments.companyId, companyId),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function createSubcontractorPayment(
  companyId: string,
  input: CreateSubcontractorPaymentInput,
): Promise<SubcontractorPayment> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .insert(subcontractorPayments)
      .values({ ...input, companyId })
      .returning();
    return rows[0];
  }
  return mockCreate(companyId, input);
}

export async function updateSubcontractorPayment(
  companyId: string,
  id: string,
  patch: Partial<
    Omit<SubcontractorPayment, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>
  >,
): Promise<SubcontractorPayment | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(subcontractorPayments)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(subcontractorPayments.id, id),
          eq(subcontractorPayments.companyId, companyId),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockUpdate(companyId, id, patch);
}

export async function deleteSubcontractorPayment(
  companyId: string,
  id: string,
): Promise<SubcontractorPayment | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .delete(subcontractorPayments)
      .where(
        and(
          eq(subcontractorPayments.id, id),
          eq(subcontractorPayments.companyId, companyId),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockDelete(companyId, id);
}
