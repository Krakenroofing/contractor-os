// Async data accessor for purchase orders (header + line items).

import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
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
    description: string;
    unit: string | null;
    quantityOrdered: string;
    unitCost: string;
    lineTotal: string;
  }>;
};

export async function listPurchaseOrders(companyId: string): Promise<PurchaseOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.companyId, companyId))
      .orderBy(desc(purchaseOrders.createdAt));
  }
  return mockList(companyId);
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
    return await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.projectId, projectId))
      .orderBy(desc(purchaseOrders.createdAt));
  }
  return mockListForProject(projectId);
}

export async function listPurchaseOrdersForVendor(
  vendorId: string,
): Promise<PurchaseOrder[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.vendorId, vendorId))
      .orderBy(desc(purchaseOrders.createdAt));
  }
  return mockListForVendor(vendorId);
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
