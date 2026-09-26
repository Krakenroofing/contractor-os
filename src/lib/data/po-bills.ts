import 'server-only';
import { and, eq, inArray, isNotNull, isNull, ne, sql, desc } from 'drizzle-orm';
import { receiptLines, receipts, purchaseOrderLines } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

// PO → bill helpers: how much of each PO line has already been billed
// (across draft/submitted/posted bills — a draft in progress still reserves
// its share), and which bills came from a given PO.

export async function sumBilledByPoLine(
  companyId: string,
  purchaseOrderId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!isDatabaseConfigured()) return map;
  const db = getDb()!;
  const lineIds = (
    await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
  ).map((r) => r.id);
  if (lineIds.length === 0) return map;
  const rows = await db
    .select({
      poLineId: receiptLines.purchaseOrderLineId,
      total: sql<string>`COALESCE(SUM(${receiptLines.subtotal}), 0)`,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(
      and(
        eq(receiptLines.companyId, companyId),
        inArray(receiptLines.purchaseOrderLineId, lineIds),
        isNull(receiptLines.deletedAt),
        isNull(receipts.deletedAt),
        ne(receipts.status, 'void'),
      ),
    )
    .groupBy(receiptLines.purchaseOrderLineId);
  for (const r of rows) {
    if (r.poLineId) map.set(r.poLineId, Number(r.total));
  }
  return map;
}

/** Job-costed amount already posted by bills, per PO line — what those
 *  bills' job-cost entries carry (posted, non-deleted bills only). */
export async function sumPostedJobCostedByPoLine(
  companyId: string,
  poLineIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!isDatabaseConfigured() || poLineIds.length === 0) return map;
  const db = getDb()!;
  const rows = await db
    .select({
      poLineId: receiptLines.purchaseOrderLineId,
      total: sql<string>`COALESCE(SUM(${receiptLines.subtotal}), 0)`,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(
      and(
        eq(receiptLines.companyId, companyId),
        inArray(receiptLines.purchaseOrderLineId, poLineIds),
        isNull(receiptLines.deletedAt),
        isNull(receipts.deletedAt),
        eq(receipts.status, 'posted'),
        isNotNull(receiptLines.postedJobCostEntryId),
      ),
    )
    .groupBy(receiptLines.purchaseOrderLineId);
  for (const r of rows) {
    if (r.poLineId) map.set(r.poLineId, Number(r.total));
  }
  return map;
}

/**
 * Actual cost a PO line contributes to job costing on top of job-cost
 * entries. GR/IR POs: nothing — goods receipts and bills post job-cost
 * entries themselves. Legacy POs: received value not yet covered by a
 * posted bill's job cost (received-not-billed), so a line that's both
 * received and billed counts once.
 */
export function poLineActualBeyondJobCost(
  po: { grir: boolean },
  line: { id: string; quantityReceived: string; unitCost: string },
  postedBilled: Map<string, number>,
): number {
  if (po.grir) return 0;
  const received =
    Math.round(Number(line.quantityReceived) * Number(line.unitCost) * 100) / 100;
  return Math.max(0, Math.round((received - (postedBilled.get(line.id) ?? 0)) * 100) / 100);
}

export type PoBillRow = {
  id: string;
  receiptDate: string;
  vendorInvoiceNumber: string | null;
  total: string;
  status: string;
};

export async function listBillsForPo(
  companyId: string,
  purchaseOrderId: string,
): Promise<PoBillRow[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return db
    .select({
      id: receipts.id,
      receiptDate: receipts.receiptDate,
      vendorInvoiceNumber: receipts.vendorInvoiceNumber,
      total: receipts.total,
      status: receipts.status,
    })
    .from(receipts)
    .where(
      and(
        eq(receipts.companyId, companyId),
        eq(receipts.purchaseOrderId, purchaseOrderId),
        isNull(receipts.deletedAt),
      ),
    )
    .orderBy(desc(receipts.receiptDate));
}

/** Guard against duplicate vendor invoice numbers for the same vendor. */
export async function findBillByVendorInvoiceNumber(
  companyId: string,
  vendorId: string,
  vendorInvoiceNumber: string,
  excludeReceiptId?: string,
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb()!;
  const rows = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(
      and(
        eq(receipts.companyId, companyId),
        eq(receipts.vendorId, vendorId),
        sql`lower(${receipts.vendorInvoiceNumber}) = lower(${vendorInvoiceNumber})`,
        isNull(receipts.deletedAt),
        // A voided bill's corrected copy carries the same supplier number.
        ne(receipts.status, 'void'),
        excludeReceiptId ? ne(receipts.id, excludeReceiptId) : undefined,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}
