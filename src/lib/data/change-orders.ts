// Async data accessor for change orders (header + line items).
//
// Approving a CO mirrors the demo behavior: project.contractValue and
// project.totalChangeOrders both increase by the CO total. That mutation is
// implemented via `applyApprovedCOToProject`, which is also called from the
// status-transition dispatcher when an existing CO flips to `approved`.

import 'server-only';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
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

export async function listChangeOrders(
  companyId: string,
  options: { includeVoided?: boolean } = {},
): Promise<ChangeOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const where = options.includeVoided
      ? eq(changeOrders.companyId, companyId)
      : and(eq(changeOrders.companyId, companyId), ne(changeOrders.status, 'void'));
    return await db
      .select()
      .from(changeOrders)
      .where(where)
      .orderBy(desc(changeOrders.createdAt));
  }
  const all = mockList(companyId);
  return options.includeVoided ? all : all.filter((c) => c.status !== 'void');
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

// Resolve change-order ids to their display numbers (e.g. "CO-2026-003") in
// one query. Used to label documents linked to a change order. Returns a map
// keyed by id; ids not found (or from another company) are simply absent.
export async function getChangeOrderNumbers(
  companyId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return map;
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select({ id: changeOrders.id, number: changeOrders.number })
      .from(changeOrders)
      .where(
        and(
          eq(changeOrders.companyId, companyId),
          inArray(changeOrders.id, unique),
        ),
      );
    for (const r of rows) map.set(r.id, r.number);
    return map;
  }
  for (const id of unique) {
    const co = mockGet(companyId, id);
    if (co) map.set(co.id, co.number);
  }
  return map;
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
  options: { includeVoided?: boolean } = {},
): Promise<ChangeOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const where = options.includeVoided
      ? eq(changeOrders.projectId, projectId)
      : and(eq(changeOrders.projectId, projectId), ne(changeOrders.status, 'void'));
    return await db
      .select()
      .from(changeOrders)
      .where(where)
      .orderBy(desc(changeOrders.createdAt));
  }
  const all = mockListForProject(projectId);
  return options.includeVoided ? all : all.filter((c) => c.status !== 'void');
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
// Self-heal: recompute project.totalChangeOrders and project.contractValue
// from the authoritative sum of approved (non-void) COs. Useful as a
// recovery action when the running balance drifted (e.g., from an earlier
// bug or a manual DB edit).
export async function recomputeProjectContractTotalsFromCOs(
  projectId: string,
): Promise<{
  originalContractValue: number;
  approvedCOTotal: number;
  newContractValue: number;
} | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const proj = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (proj.length === 0) return null;
  const project = proj[0];

  const approvedRows = await db
    .select({ total: changeOrders.total })
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.projectId, projectId),
        eq(changeOrders.status, 'approved'),
      ),
    );

  const approvedCOTotal = approvedRows.reduce(
    (acc, r) => acc + Number(r.total),
    0,
  );
  const originalContractValue = Number(project.originalContractValue);
  const newContractValue = originalContractValue + approvedCOTotal;

  // Embed as numeric literals to avoid any parameter-type ambiguity.
  const lit = (n: number) => sql.raw(`(${n.toFixed(2)})::numeric`);
  await db
    .update(projects)
    .set({
      totalChangeOrders: lit(approvedCOTotal),
      contractValue: lit(newContractValue),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return { originalContractValue, approvedCOTotal, newContractValue };
}

export async function applyApprovedCOToProject(
  projectId: string,
  amount: number,
): Promise<void> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Embed the amount as a numeric literal rather than a bound parameter
    // so Postgres can't get confused about types. `amount.toFixed(2)` gives
    // us a deterministic decimal string; we then explicitly cast it to
    // numeric. Positive amount adds; caller passes negative for reversals.
    const amountLiteral = sql.raw(`(${amount.toFixed(2)})::numeric`);
    await db
      .update(projects)
      .set({
        contractValue: sql`${projects.contractValue} + ${amountLiteral}`,
        totalChangeOrders: sql`${projects.totalChangeOrders} + ${amountLiteral}`,
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

/**
 * Next "CO-YYYY-NNN" number for this company. Mirrors the helper on the
 * new-CO page so auto-created deduct COs share the operator's sequence.
 */
export async function nextChangeOrderNumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await listChangeOrders(companyId, { includeVoided: true });
  const prefix = `CO-${year}-`;
  const matching = existing
    .map((c) => c.number)
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/**
 * Create an approved *deduct* (negative) change order that records a
 * canceled / reduced scope being refunded. `amount` is the positive refund
 * value (net of VAT, matching how contracts are stored); the CO is booked at
 * −amount so it lowers the project's revised contract value. No line items —
 * the credit is a single header-level reduction, described in `description`.
 *
 * Returns the created CO. The caller links it onto the credit memo.
 */
export async function createDeductChangeOrderForRefund(
  companyId: string,
  input: {
    projectId: string;
    amount: number;
    issueDate: string;
    description: string;
  },
): Promise<ChangeOrder> {
  const negativeTotal = (-Math.abs(input.amount)).toFixed(2);
  const number = await nextChangeOrderNumber(companyId);
  return await createChangeOrder(companyId, {
    number,
    projectId: input.projectId,
    proposalId: null,
    status: 'approved',
    reason: 'scope_change',
    description: input.description,
    scheduleImpactDays: 0,
    submittedAt: input.issueDate,
    approvedAt: input.issueDate,
    customerSignedName: null,
    subtotal: negativeTotal,
    total: negativeTotal,
    lines: [],
  });
}

export type UpdateChangeOrderInput = Omit<CreateChangeOrderInput, 'number'> & {
  number: string;
};

// Updates a change order + replaces its line items + adjusts project totals
// based on the status-and-total delta:
//
//   prev status     new status   delta to project.contractValue
//   --------------- ------------ -------------------------------
//   not approved    not approved 0
//   not approved    approved     +new.total                  (apply)
//   approved        not approved -prev.total                 (reverse)
//   approved        approved     new.total - prev.total      (re-balance)
//
// Demo mode falls through to the mock store, which has equivalent semantics.
export async function updateChangeOrder(
  companyId: string,
  id: string,
  input: UpdateChangeOrderInput,
): Promise<ChangeOrder | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const existingRow = await db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.id, id), eq(changeOrders.companyId, companyId)))
      .limit(1);
    if (existingRow.length === 0) return undefined;
    const prev = existingRow[0];

    // Uniqueness check on number — exclude self.
    if (prev.number !== input.number) {
      const dupe = await db
        .select({ id: changeOrders.id })
        .from(changeOrders)
        .where(
          and(
            eq(changeOrders.companyId, companyId),
            eq(changeOrders.number, input.number),
            ne(changeOrders.id, id),
          ),
        )
        .limit(1);
      if (dupe.length > 0) throw new DuplicateChangeOrderNumberError();
    }

    const now = new Date();
    const wasApproved = prev.status === 'approved';
    const willBeApproved = input.status === 'approved';

    await db
      .update(changeOrders)
      .set({
        projectId: input.projectId,
        proposalId: input.proposalId,
        number: input.number,
        status: input.status,
        reason: input.reason,
        description: input.description,
        subtotal: input.subtotal,
        total: input.total,
        scheduleImpactDays: input.scheduleImpactDays,
        submittedAt: input.submittedAt,
        approvedAt: input.approvedAt,
        customerSignedName: input.customerSignedName,
        rejectedAt:
          input.status === 'rejected'
            ? prev.rejectedAt ?? now.toISOString().slice(0, 10)
            : null,
        updatedAt: now,
      })
      .where(and(eq(changeOrders.id, id), eq(changeOrders.companyId, companyId)));

    // Bulk-replace line items.
    await db
      .delete(changeOrderLineItems)
      .where(eq(changeOrderLineItems.changeOrderId, id));
    if (input.lines.length > 0) {
      await db.insert(changeOrderLineItems).values(
        input.lines.map((l, i) => ({
          changeOrderId: id,
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

    // Apply contract-value delta. Project may also have changed via edit —
    // if so, reverse on the old project and apply on the new.
    const prevTotal = Number(prev.total);
    const newTotal = Number(input.total);
    const projectChanged = prev.projectId !== input.projectId;

    if (projectChanged) {
      if (wasApproved) {
        await applyApprovedCOToProject(prev.projectId, -prevTotal);
      }
      if (willBeApproved) {
        await applyApprovedCOToProject(input.projectId, newTotal);
      }
    } else if (wasApproved && willBeApproved) {
      const delta = newTotal - prevTotal;
      if (delta !== 0) {
        await applyApprovedCOToProject(input.projectId, delta);
      }
    } else if (!wasApproved && willBeApproved) {
      await applyApprovedCOToProject(input.projectId, newTotal);
    } else if (wasApproved && !willBeApproved) {
      await applyApprovedCOToProject(input.projectId, -prevTotal);
    }

    const updated = await db
      .select()
      .from(changeOrders)
      .where(and(eq(changeOrders.id, id), eq(changeOrders.companyId, companyId)))
      .limit(1);
    return updated[0];
  }
  // Demo mode: defer to the mock store (which doesn't currently expose a
  // dedicated update — for now, return undefined so the demo path is
  // explicitly unsupported. The action layer surfaces a friendly message.)
  return undefined;
}
