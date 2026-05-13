// Async data accessor for change orders (header + line items).
//
// Approving a CO mirrors the demo behavior: project.contractValue and
// project.totalChangeOrders both increase by the CO total. That mutation is
// implemented via `applyApprovedCOToProject`, which is also called from the
// status-transition dispatcher when an existing CO flips to `approved`.

import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  changeOrderLineItems,
  changeOrders,
  projects,
  type ChangeOrder,
  type ChangeOrderLineItem,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockChangeOrders as mockList,
  getMockChangeOrder as mockGet,
  getMockChangeOrderLineItems as mockGetLines,
  listChangeOrdersForProject as mockListForProject,
  listApprovedChangeOrdersForProject as mockListApprovedForProject,
  createMockChangeOrder as mockCreate,
  applyApprovedCOToProjectInMemory,
  DuplicateChangeOrderNumberError,
} from '@/lib/mock-store';

export { DuplicateChangeOrderNumberError };

export type CreateChangeOrderInput = {
  number: string;
  projectId: string;
  proposalId: string | null;
  status: ChangeOrder['status'];
  reason: ChangeOrder['reason'];
  description: string;
  scheduleImpactDays: number;
  submittedAt: string | null;
  approvedAt: string | null;
  customerSignedName: string | null;
  subtotal: string;
  total: string;
  lines: Array<{
    costCodeId: string;
    description: string;
    unit: string | null;
    quantity: string;
    unitCost: string;
    markupPercent: string;
    lineTotal: string;
  }>;
};

export async function listChangeOrders(companyId: string): Promise<ChangeOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.companyId, companyId))
      .orderBy(desc(changeOrders.createdAt));
  }
  return mockList(companyId);
}

export async function getChangeOrder(
  companyId: string,
  id: string,
): Promise<ChangeOrder | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.id, id), eq(changeOrders.companyId, companyId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function getChangeOrderLineItems(
  coId: string,
): Promise<ChangeOrderLineItem[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(changeOrderLineItems)
      .where(eq(changeOrderLineItems.changeOrderId, coId))
      .orderBy(asc(changeOrderLineItems.sortOrder));
  }
  return mockGetLines(coId);
}

export async function listChangeOrdersForProject(
  projectId: string,
): Promise<ChangeOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.projectId, projectId))
      .orderBy(desc(changeOrders.createdAt));
  }
  return mockListForProject(projectId);
}

export async function listApprovedChangeOrdersForProject(
  projectId: string,
): Promise<ChangeOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(changeOrders)
      .where(
        and(
          eq(changeOrders.projectId, projectId),
          eq(changeOrders.status, 'approved'),
        ),
      );
  }
  return mockListApprovedForProject(projectId);
}

/**
 * Bumps `project.contractValue` and `project.totalChangeOrders` by `amount`.
 * In demo mode mutates the in-memory project; in DB mode runs an UPDATE with
 * an arithmetic expression so the change is atomic.
 */
export async function applyApprovedCOToProject(
  projectId: string,
  amount: number,
): Promise<void> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    await db
      .update(projects)
      .set({
        // Postgres numeric arithmetic, kept inside the DB so concurrent
        // approvals don't lose updates. Both columns are numeric(14,2) so
        // the result is numeric — no cast needed (and casting to ::text
        // would mismatch the column type and raise 42804).
        contractValue: sql`${projects.contractValue} + ${amount}`,
        totalChangeOrders: sql`${projects.totalChangeOrders} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
    return;
  }
  applyApprovedCOToProjectInMemory(projectId, amount);
}

export async function createChangeOrder(
  companyId: string,
  input: CreateChangeOrderInput,
): Promise<ChangeOrder> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const existing = await db
      .select({ id: changeOrders.id })
      .from(changeOrders)
      .where(
        and(
          eq(changeOrders.companyId, companyId),
          eq(changeOrders.number, input.number),
        ),
      )
      .limit(1);
    if (existing.length > 0) throw new DuplicateChangeOrderNumberError();

    const now = new Date();
    const inserted = await db
      .insert(changeOrders)
      .values({
        companyId,
        projectId: input.projectId,
        proposalId: input.proposalId,
        number: input.number,
        status: input.status,
        reason: input.reason,
        description: input.description,
        subtotal: input.subtotal,
        taxAmount: '0.00',
        total: input.total,
        scheduleImpactDays: input.scheduleImpactDays,
        publicToken: null,
        submittedAt: input.submittedAt,
        sentAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
        customerSignedAt: input.status === 'approved' ? now : null,
        customerSignedName: input.customerSignedName,
        customerSignedIp: null,
        approvedAt: input.approvedAt,
        rejectedAt: input.status === 'rejected' ? now.toISOString().slice(0, 10) : null,
      })
      .returning();
    const co = inserted[0];

    if (input.lines.length > 0) {
      await db.insert(changeOrderLineItems).values(
        input.lines.map((l, i) => ({
          changeOrderId: co.id,
          costCodeId: l.costCodeId,
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

    if (input.status === 'approved') {
      await applyApprovedCOToProject(input.projectId, Number(input.total));
    }

    return co;
  }
  return mockCreate(companyId, input);
}
