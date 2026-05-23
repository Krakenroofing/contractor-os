// Async data accessor for estimates (header + line items).
//
// Status timestamps (sentAt / approvedAt / submittedAt / rejectedAt) are
// computed from the incoming `status` exactly as the mock-store does, so the
// behavior on first save matches across both backends. Subsequent status
// flips go through `setEstimateStatus` (called by the workflow transition
// action).

import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  estimateLineItems,
  estimates,
  type Estimate,
  type EstimateLineItem,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockEstimates as mockList,
  getMockEstimate as mockGet,
  getMockEstimateLineItems as mockGetLines,
  listEstimatesForProject as mockListForProject,
  createMockEstimate as mockCreate,
  updateMockEstimateHeader as mockUpdateHeader,
  DuplicateEstimateNumberError,
} from '@/lib/mock-store';

export { DuplicateEstimateNumberError };

export type CreateEstimateInput = {
  number: string;
  projectId: string;
  status: Estimate['status'];
  validUntil: string | null;
  lines: Array<{
    costCodeId: string;
    inventoryItemId: string | null;
    description: string;
    unit: string | null;
    quantity: string;
    unitCost: string;
    markupPercent: string;
    lineTotal: string;
  }>;
  subtotal: string;
  total: string;
};

function timestampsForStatus(status: Estimate['status'], now: Date) {
  return {
    submittedAt:
      status === 'internal_review' ||
      status === 'sent' ||
      status === 'approved' ||
      status === 'rejected'
        ? now
        : null,
    sentAt:
      status === 'sent' || status === 'approved' || status === 'rejected'
        ? now
        : null,
    approvedAt: status === 'approved' ? now : null,
    rejectedAt: status === 'rejected' ? now : null,
  };
}

export async function listEstimates(companyId: string): Promise<Estimate[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(estimates)
      .where(eq(estimates.companyId, companyId))
      .orderBy(desc(estimates.createdAt));
  }
  return mockList(companyId);
}

export async function getEstimate(
  companyId: string,
  id: string,
): Promise<Estimate | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(estimates)
      .where(and(eq(estimates.id, id), eq(estimates.companyId, companyId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function getEstimateLineItems(
  estimateId: string,
): Promise<EstimateLineItem[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimateId))
      .orderBy(asc(estimateLineItems.sortOrder));
  }
  return mockGetLines(estimateId);
}

export async function listEstimatesForProject(
  companyId: string,
  projectId: string,
): Promise<Estimate[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(estimates)
      .where(and(eq(estimates.companyId, companyId), eq(estimates.projectId, projectId)))
      .orderBy(desc(estimates.createdAt));
  }
  return mockListForProject(projectId);
}

export async function createEstimate(
  companyId: string,
  input: CreateEstimateInput,
): Promise<Estimate> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Enforce per-company uniqueness on `number`, matching the mock store.
    const existing = await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(and(eq(estimates.companyId, companyId), eq(estimates.number, input.number)))
      .limit(1);
    if (existing.length > 0) throw new DuplicateEstimateNumberError();

    const now = new Date();
    const ts = timestampsForStatus(input.status, now);

    const inserted = await db
      .insert(estimates)
      .values({
        companyId,
        projectId: input.projectId,
        number: input.number,
        version: 1,
        status: input.status,
        subtotal: input.subtotal,
        taxAmount: '0.00',
        total: input.total,
        markupPercent: '0.000',
        overheadPercent: '0.000',
        validUntil: input.validUntil,
        ...ts,
        parentEstimateId: null,
      })
      .returning();
    const row = inserted[0];

    if (input.lines.length > 0) {
      await db.insert(estimateLineItems).values(
        input.lines.map((l, i) => ({
          estimateId: row.id,
          sectionId: null,
          costCodeId: l.costCodeId,
          assemblyId: null,
          inventoryItemId: l.inventoryItemId,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitCost: l.unitCost,
          markupPercent: l.markupPercent,
          lineTotal: l.lineTotal,
          sortOrder: i,
        })),
      );
    }

    return row;
  }
  return mockCreate(companyId, input);
}

// Status transitions for all 6 workflow entities live in the central
// `updateEntityStatus` dispatcher in @/lib/mock-store, which is now DB-aware.

/**
 * Header-only patch. Line items are NOT editable in this update path —
 * once an estimate has lines, recreating-with-new-lines is the safe way
 * to change them (avoids partial recomputes of subtotal / total / line
 * sort order). Edit only allowed while the estimate is still `draft`;
 * the action layer enforces that.
 */
export type UpdateEstimateHeaderInput = {
  validUntil: string | null;
};

export async function updateEstimateHeader(
  companyId: string,
  id: string,
  patch: UpdateEstimateHeaderInput,
): Promise<Estimate | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(estimates)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(estimates.id, id), eq(estimates.companyId, companyId)))
      .returning();
    return rows[0];
  }
  return mockUpdateHeader(companyId, id, patch);
}
