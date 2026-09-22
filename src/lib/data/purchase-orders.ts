// Async data accessor for purchase orders (header + line items).

import 'server-only';
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm';
import {
  purchaseOrderLines,
  purchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { nextNumberInSequence } from '@/lib/next-number';
import {
  listMockPurchaseOrders as mockList,
  getMockPurchaseOrder as mockGet,
  getMockPurchaseOrderLines as mockGetLines,
  listPurchaseOrdersForProject as mockListForProject,
  listPurchaseOrdersForVendor as mockListForVendor,
  findPurchaseOrderForLandedCost as mockFindForLandedCost,
  createMockPurchaseOrder as mockCreate,
  updateMockPurchaseOrderHeader as mockUpdateHeader,
  DuplicatePONumberError,
} from '@/lib/mock-store';

export { DuplicatePONumberError };

/**
 * Next PO number following whatever scheme the company already uses
 * ("PO019" -> "PO020"). Shared by the new-PO page prefill and the
 * PDF-extraction create path so both stay on one sequence.
 */
export async function nextPurchaseOrderNumber(companyId: string): Promise<string> {
  const existing = await listPurchaseOrders(companyId);
  return nextNumberInSequence(
    existing,
    `PO-${new Date().getFullYear()}-001`,
  );
}

export type CreatePurchaseOrderInput = {
  number: string;
  projectId: string;
  vendorId: string;
  landedCostEntryId: string | null;
  status: PurchaseOrder['status'];
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  subtotal: string;
  taxAmount: string;
  shipping: string;
  total: string;
  lines: Array<{
    costCodeId: string;
    inventoryItemId: string | null;
    /** Line-level job override; null = the PO header's project. */
    projectId?: string | null;
    description: string;
    unit: string | null;
    quantityOrdered: string;
    unitCost: string;
    lineTotal: string;
  }>;
};

/** Natural PO-number order: PO2 < PO012 < PO0018 (digit runs compare as
 *  numbers, not characters). All list endpoints return POs in this order. */
function byNaturalNumber(rows: PurchaseOrder[]): PurchaseOrder[] {
  return [...rows].sort((a, b) =>
    a.number.localeCompare(b.number, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );
}

export async function listPurchaseOrders(companyId: string): Promise<PurchaseOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return byNaturalNumber(
      await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.companyId, companyId)),
    );
  }
  return byNaturalNumber(mockList(companyId));
}

export async function getPurchaseOrder(
  companyId: string,
  id: string,
): Promise<PurchaseOrder | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, companyId)),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function getPurchaseOrderLines(
  poId: string,
): Promise<PurchaseOrderLine[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, poId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
  }
  return mockGetLines(poId);
}

export async function listPurchaseOrdersForProject(
  projectId: string,
): Promise<PurchaseOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Header project OR any line tagged to this project — a split PO
    // belongs to every job its lines touch. Callers that sum costs must
    // attribute per line (line.projectId ?? po.projectId), not per PO.
    const lineMatches = db
      .select({ id: purchaseOrderLines.purchaseOrderId })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.projectId, projectId));
    return byNaturalNumber(
      await db
        .select()
        .from(purchaseOrders)
        .where(
          or(
            eq(purchaseOrders.projectId, projectId),
            inArray(purchaseOrders.id, lineMatches),
          ),
        ),
    );
  }
  return byNaturalNumber(mockListForProject(projectId));
}

export async function listPurchaseOrdersForVendor(
  vendorId: string,
): Promise<PurchaseOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return byNaturalNumber(
      await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.vendorId, vendorId)),
    );
  }
  return byNaturalNumber(mockListForVendor(vendorId));
}

export async function findPurchaseOrderForLandedCost(
  landedCostId: string,
): Promise<PurchaseOrder | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.landedCostEntryId, landedCostId))
      .limit(1);
    return rows[0];
  }
  return mockFindForLandedCost(landedCostId);
}

/**
 * Wires an existing PO's `landedCostEntryId` pointer. Used by createLandedCost
 * to keep the bidirectional link in sync (the PO references the landed cost
 * row that captures its all-in cost).
 */
export async function setPurchaseOrderLandedCostId(
  companyId: string,
  poId: string,
  landedCostId: string | null,
): Promise<void> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    await db
      .update(purchaseOrders)
      .set({ landedCostEntryId: landedCostId, updatedAt: new Date() })
      .where(
        and(eq(purchaseOrders.id, poId), eq(purchaseOrders.companyId, companyId)),
      );
    return;
  }
  // In demo mode the createLandedCost helper inside mock-store already wires
  // this on a single in-memory pass — nothing to do here.
}

export async function createPurchaseOrder(
  companyId: string,
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrder> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const existing = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          eq(purchaseOrders.number, input.number),
        ),
      )
      .limit(1);
    if (existing.length > 0) throw new DuplicatePONumberError();

    const now = new Date();
    const inserted = await db
      .insert(purchaseOrders)
      .values({
        companyId,
        projectId: input.projectId,
        vendorId: input.vendorId,
        landedCostEntryId: input.landedCostEntryId,
        number: input.number,
        status: input.status,
        issueDate: input.issueDate,
        expectedDeliveryDate: input.expectedDeliveryDate,
        shipToAddressLine1: null,
        shipToCity: null,
        shipToState: null,
        shipToPostalCode: null,
        subtotal: input.subtotal,
        taxAmount: input.taxAmount,
        shipping: input.shipping,
        total: input.total,
        notes: input.notes,
        issuedAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
        closedAt: input.status === 'closed' ? now : null,
      })
      .returning();
    const po = inserted[0];

    if (input.lines.length > 0) {
      await db.insert(purchaseOrderLines).values(
        input.lines.map((l, i) => ({
          purchaseOrderId: po.id,
          costCodeId: l.costCodeId,
          inventoryItemId: l.inventoryItemId,
          projectId: l.projectId ?? null,
          description: l.description,
          unit: l.unit,
          quantityOrdered: l.quantityOrdered,
          quantityReceived: '0.0000',
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
          sortOrder: i,
        })),
      );
    }

    return po;
  }
  return mockCreate(companyId, input);
}

/**
 * Header-only update — issue / expected-delivery dates, ship-to address,
 * notes. Line items, totals, vendor, project, and status (which gates
 * receipt / closed lifecycle) are NOT touched here. Edit only allowed
 * while the PO is still `draft`; the action layer enforces that.
 */
export type CloseShortResult =
  | {
      ok: true;
      /** Lines whose un-received remainder was cancelled. */
      trimmed: Array<{
        description: string;
        orderedBefore: number;
        received: number;
        cancelledValue: number;
      }>;
      cancelledValue: number;
      taxBefore: number;
      taxAfter: number;
      newTotal: number;
    }
  | { ok: false; error: string };

/**
 * "Cancel remaining & close": the supplier won't ship the rest, so trim
 * every line's ordered quantity down to what was actually received
 * (cancelling the remainder), scale the PO's tax to the surviving
 * subtotal, and close the PO. Closed POs drop out of AP committed and
 * open-commitment math — the cancelled remainder stops being money the
 * company expects to spend. History lives in the activity log.
 */
export async function closePurchaseOrderShort(
  companyId: string,
  poId: string,
): Promise<CloseShortResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: 'Requires a configured database.' };
  }
  const db = getDb()!;
  const po = await getPurchaseOrder(companyId, poId);
  if (!po) return { ok: false, error: 'Purchase order not found.' };
  if (
    po.status !== 'issued' &&
    po.status !== 'partially_received' &&
    po.status !== 'received'
  ) {
    return {
      ok: false,
      error: `PO is ${po.status} — only ordered / partially received / received POs can be closed short.`,
    };
  }

  const lines = await getPurchaseOrderLines(poId);
  const anyReceived = lines.some((l) => Number(l.quantityReceived) > 0);
  if (!anyReceived) {
    return {
      ok: false,
      error:
        'Nothing has been received on this PO — if the whole order is cancelled, Void it instead (status panel).',
    };
  }

  const trimmed: Array<{
    description: string;
    orderedBefore: number;
    received: number;
    cancelledValue: number;
  }> = [];
  let newSubtotal = 0;
  const lineUpdates: Array<{ id: string; qty: number; lineTotal: number }> = [];
  for (const l of lines) {
    const ordered = Number(l.quantityOrdered);
    const received = Number(l.quantityReceived);
    const unitCost = Number(l.unitCost);
    const keptQty = Math.min(ordered, received);
    const keptTotal = Math.round(keptQty * unitCost * 100) / 100;
    newSubtotal += keptTotal;
    if (received < ordered - 0.00005) {
      trimmed.push({
        description: l.description,
        orderedBefore: ordered,
        received,
        cancelledValue:
          Math.round((ordered - received) * unitCost * 100) / 100,
      });
      lineUpdates.push({ id: l.id, qty: keptQty, lineTotal: keptTotal });
    }
  }
  newSubtotal = Math.round(newSubtotal * 100) / 100;

  const oldSubtotal = Number(po.subtotal);
  const taxBefore = Number(po.taxAmount);
  // Tax follows the goods: scale it to the surviving subtotal (the vendor
  // only taxes what ships). No trim = tax unchanged.
  const taxAfter =
    trimmed.length > 0 && oldSubtotal > 0
      ? Math.round(taxBefore * (newSubtotal / oldSubtotal) * 100) / 100
      : taxBefore;
  const shipping = Number(po.shipping);
  const newTotal = Math.round((newSubtotal + taxAfter + shipping) * 100) / 100;

  await db.transaction(async (tx) => {
    for (const u of lineUpdates) {
      await tx
        .update(purchaseOrderLines)
        .set({
          quantityOrdered: u.qty.toFixed(4),
          lineTotal: u.lineTotal.toFixed(2),
        })
        .where(eq(purchaseOrderLines.id, u.id));
    }
    await tx
      .update(purchaseOrders)
      .set({
        subtotal: newSubtotal.toFixed(2),
        taxAmount: taxAfter.toFixed(2),
        total: newTotal.toFixed(2),
        status: 'closed',
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrders.id, poId),
          eq(purchaseOrders.companyId, companyId),
        ),
      );
  });

  const cancelledValue =
    Math.round(trimmed.reduce((s, t) => s + t.cancelledValue, 0) * 100) / 100;
  return { ok: true, trimmed, cancelledValue, taxBefore, taxAfter, newTotal };
}

export type UpdatePurchaseOrderHeaderInput = {
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  shipToAddressLine1: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  notes: string | null;
};

/**
 * Rename a PO (its human-facing number only). Allowed in any status — every
 * link (lines, receipts, bills, job costing) is by id, so the number is
 * purely cosmetic. Throws DuplicatePONumberError when another PO in the
 * company already uses the number.
 */
export async function renamePurchaseOrder(
  companyId: string,
  id: string,
  number: string,
): Promise<PurchaseOrder | undefined> {
  if (!isDatabaseConfigured()) {
    throw new Error('Renaming POs requires a configured database.');
  }
  const db = getDb()!;
  const clash = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        eq(purchaseOrders.number, number),
        ne(purchaseOrders.id, id),
      ),
    )
    .limit(1);
  if (clash.length > 0) throw new DuplicatePONumberError();

  const rows = await db
    .update(purchaseOrders)
    .set({ number, updatedAt: new Date() })
    .where(
      and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, companyId)),
    )
    .returning();
  return rows[0];
}

/** Record / change the supplier's own invoice number on a PO. Allowed in
 *  any status — the vendor's bill arrives long after the PO is issued. */
export async function setPurchaseOrderVendorInvoiceNumber(
  companyId: string,
  id: string,
  vendorInvoiceNumber: string | null,
): Promise<PurchaseOrder | undefined> {
  if (!isDatabaseConfigured()) {
    throw new Error('Editing POs requires a configured database.');
  }
  const db = getDb()!;
  const rows = await db
    .update(purchaseOrders)
    .set({ vendorInvoiceNumber, updatedAt: new Date() })
    .where(
      and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, companyId)),
    )
    .returning();
  return rows[0];
}

export type UpdatePurchaseOrderWithLinesInput = {
  projectId: string;
  vendorId: string;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  subtotal: string;
  taxAmount: string;
  shipping: string;
  total: string;
  lines: Array<{
    /** Existing line's id — its received quantity and receipt history
     *  survive the edit. Undefined/null = a brand-new line. */
    id?: string | null;
    costCodeId: string;
    inventoryItemId: string | null;
    projectId?: string | null;
    description: string;
    unit: string | null;
    quantityOrdered: string;
    unitCost: string;
    lineTotal: string;
  }>;
};

/**
 * Full PO edit: header fields + line set. Existing lines (by id) are
 * updated in place so quantity_received and po_receipt_lines stay
 * attached; new lines insert; lines dropped from the payload delete ONLY
 * when nothing has been received against them — otherwise the whole edit
 * is refused so receipt history can never be orphaned.
 */
export async function updatePurchaseOrderWithLines(
  companyId: string,
  id: string,
  input: UpdatePurchaseOrderWithLinesInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: 'PO editing requires a configured database.' };
  }
  const db = getDb()!;
  const existing = await getPurchaseOrder(companyId, id);
  if (!existing) return { ok: false, error: 'Purchase order not found.' };

  const currentLines = await getPurchaseOrderLines(id);
  const currentById = new Map(currentLines.map((l) => [l.id, l]));
  const keptIds = new Set(
    input.lines.map((l) => l.id).filter((x): x is string => Boolean(x)),
  );
  for (const lineId of keptIds) {
    if (!currentById.has(lineId)) {
      return { ok: false, error: 'One of the edited lines is not on this PO.' };
    }
  }
  const removed = currentLines.filter((l) => !keptIds.has(l.id));
  const blocked = removed.filter((l) => Number(l.quantityReceived) > 0);
  if (blocked.length > 0) {
    return {
      ok: false,
      error: `Can't remove "${blocked[0].description.slice(0, 60)}" — ${Number(
        blocked[0].quantityReceived,
      )} already received against it. Adjust the quantity instead of deleting the line.`,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(purchaseOrders)
      .set({
        projectId: input.projectId,
        vendorId: input.vendorId,
        issueDate: input.issueDate,
        expectedDeliveryDate: input.expectedDeliveryDate,
        notes: input.notes,
        subtotal: input.subtotal,
        taxAmount: input.taxAmount,
        shipping: input.shipping,
        total: input.total,
        updatedAt: new Date(),
      })
      .where(
        and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, companyId)),
      );

    if (removed.length > 0) {
      await tx.delete(purchaseOrderLines).where(
        inArray(
          purchaseOrderLines.id,
          removed.map((l) => l.id),
        ),
      );
    }

    for (const [i, l] of input.lines.entries()) {
      if (l.id) {
        await tx
          .update(purchaseOrderLines)
          .set({
            costCodeId: l.costCodeId,
            inventoryItemId: l.inventoryItemId,
            projectId: l.projectId ?? null,
            description: l.description,
            unit: l.unit,
            quantityOrdered: l.quantityOrdered,
            unitCost: l.unitCost,
            lineTotal: l.lineTotal,
            sortOrder: i,
          })
          .where(
            and(
              eq(purchaseOrderLines.id, l.id),
              eq(purchaseOrderLines.purchaseOrderId, id),
            ),
          );
      } else {
        await tx.insert(purchaseOrderLines).values({
          purchaseOrderId: id,
          costCodeId: l.costCodeId,
          inventoryItemId: l.inventoryItemId,
          projectId: l.projectId ?? null,
          description: l.description,
          unit: l.unit,
          quantityOrdered: l.quantityOrdered,
          quantityReceived: '0.0000',
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
          sortOrder: i,
        });
      }
    }
  });
  return { ok: true };
}

export async function updatePurchaseOrderHeader(
  companyId: string,
  id: string,
  patch: UpdatePurchaseOrderHeaderInput,
): Promise<PurchaseOrder | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .update(purchaseOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
        ),
      )
      .returning();
    return rows[0];
  }
  return mockUpdateHeader(companyId, id, patch);
}
