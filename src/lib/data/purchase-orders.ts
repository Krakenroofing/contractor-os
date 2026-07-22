// Async data accessor for purchase orders (header + line items).

import 'server-only';
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  purchaseOrderLines,
  purchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
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
    return byNaturalNumber(
      await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.projectId, projectId)),
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
