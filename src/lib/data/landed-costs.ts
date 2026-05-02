// Async data accessor for landed-cost entries.
//
// Each landed-cost row optionally pairs with a PO via PO.landedCostEntryId.
// Creating a landed cost with a `purchaseOrderId` set wires that link in both
// directions; we use `setPurchaseOrderLandedCostId` from the PO data layer
// to keep the back-reference consistent across DB / demo modes.

import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { landedCosts, type LandedCost } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockLandedCosts as mockList,
  getMockLandedCost as mockGet,
  listLandedCostsForProject as mockListForProject,
  createMockLandedCost as mockCreate,
} from '@/lib/mock-store';
import { setPurchaseOrderLandedCostId } from '@/lib/data/purchase-orders';

export type CreateLandedCostInput = {
  name: string;
  projectId: string;
  vendorId: string | null;
  purchaseOrderId: string | null;
  carrier: string;
  itemDescription: string | null;
  tariffCode: string | null;
  quantity: string;
  unitCost: string;
  materialCost: string;
  flDelivery: string;
  crating: string;
  freightCost: string;
  insurance: string;
  dutyPercent: string;
  vatPercent: string;
  envLevyPercent: string;
  excisePercent: string;
  brokerage: string;
  portFees: string;
  localDelivery: string;
  fob: string;
  cif: string;
  dutyAmount: string;
  exciseAmount: string;
  envLevyAmount: string;
  vatAmount: string;
  totalLandedCost: string;
  perUnitCost: string;
  notes: string | null;
};

export async function listLandedCosts(companyId: string): Promise<LandedCost[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(landedCosts)
      .where(eq(landedCosts.companyId, companyId))
      .orderBy(desc(landedCosts.createdAt));
  }
  return mockList(companyId);
}

export async function getLandedCost(
  companyId: string,
  id: string,
): Promise<LandedCost | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(landedCosts)
      .where(and(eq(landedCosts.id, id), eq(landedCosts.companyId, companyId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function listLandedCostsForProject(
  projectId: string,
): Promise<LandedCost[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(landedCosts)
      .where(eq(landedCosts.projectId, projectId))
      .orderBy(desc(landedCosts.createdAt));
  }
  return mockListForProject(projectId);
}

export async function createLandedCost(
  companyId: string,
  input: CreateLandedCostInput,
): Promise<LandedCost> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const inserted = await db
      .insert(landedCosts)
      .values({
        companyId,
        projectId: input.projectId,
        vendorId: input.vendorId,
        name: input.name,
        carrier: input.carrier,
        itemDescription: input.itemDescription,
        tariffCode: input.tariffCode,
        unitCost: input.unitCost,
        materialCost: input.materialCost,
        flDelivery: input.flDelivery,
        crating: input.crating,
        freightCost: input.freightCost,
        insurance: input.insurance,
        dutyPercent: input.dutyPercent,
        vatPercent: input.vatPercent,
        envLevyPercent: input.envLevyPercent,
        envLevyAmount: input.envLevyAmount,
        excisePercent: input.excisePercent,
        exciseAmount: input.exciseAmount,
        brokerage: input.brokerage,
        portFees: input.portFees,
        localDelivery: input.localDelivery,
        quantity: input.quantity,
        fob: input.fob,
        cif: input.cif,
        dutyAmount: input.dutyAmount,
        vatAmount: input.vatAmount,
        totalLandedCost: input.totalLandedCost,
        perUnitCost: input.perUnitCost,
        notes: input.notes,
      })
      .returning();
    const lc = inserted[0];

    // Wire the PO back-reference so the bidirectional link is kept in sync.
    if (input.purchaseOrderId) {
      await setPurchaseOrderLandedCostId(companyId, input.purchaseOrderId, lc.id);
    }

    return lc;
  }
  return mockCreate(companyId, input);
}
