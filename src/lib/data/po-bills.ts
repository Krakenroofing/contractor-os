import 'server-only';
import { and, eq, inArray, isNull, ne, sql, desc } from 'drizzle-orm';
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
      ),
    )
    .groupBy(receiptLines.purchaseOrderLineId);
  for (const r of rows) {
    if (r.poLineId) map.set(r.poLineId, Number(r.total));
  }
  return map;
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
        excludeReceiptId ? ne(receipts.id, excludeReceiptId) : undefined,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}
