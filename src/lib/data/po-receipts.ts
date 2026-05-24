// Data layer for PO receipts (Phase 6.1).
//
// A "receipt" here is the act of physically receiving materials against a
// purchase order. One shipment becomes one po_receipts row with one or more
// po_receipt_lines that point at the PO's line items.
//
// Writes happen inside a transaction so the audit row, the per-line
// quantity_received bumps, and the header status recompute all land
// atomically — there is no valid intermediate state where the audit and
// the rollup disagree.
//
// Status flow driven from quantities:
//   - any line still under-received  → partially_received
//   - all lines met or exceeded      → received
//   - nothing received yet           → issued (unchanged)
//
// Receipts do NOT post to job_cost_entries. The vendor bill / receipt
// already handles cost posting; physical receiving is tracked separately
// so on-hand quantity (Phase 6.2 ledger) can flow from a different signal
// than cost recognition.

import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  inventoryMovements,
  poReceipts,
  poReceiptLines,
  purchaseOrderLines,
  purchaseOrders,
  type PurchaseOrder,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export type CreatePoReceiptInput = {
  receivedAt: Date;
  receivedByUserId: string | null;
  notes: string | null;
  lines: Array<{
    poLineId: string;
    quantityReceived: number;
  }>;
};

export type PoReceiptWithLines = {
  id: string;
  purchaseOrderId: string;
  receivedAt: Date;
  receivedByUserId: string | null;
  notes: string | null;
  lines: Array<{
    id: string;
    poLineId: string;
    quantityReceived: string;
  }>;
};

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'po_receipts requires a configured database — demo mode is not supported.',
    );
  }
  return getDb()!;
}

/**
 * Compute the resulting PO status from per-line ordered vs received totals.
 * Pure — exported for the action layer to preview status before writing.
 */
export function computePoStatusFromLines(
  lines: Array<{ quantityOrdered: string | number; quantityReceived: string | number }>,
): 'issued' | 'partially_received' | 'received' {
  let anyReceived = false;
  let allMet = true;
  for (const l of lines) {
    const ordered = Number(l.quantityOrdered);
    const received = Number(l.quantityReceived);
    if (received > 0) anyReceived = true;
    if (received < ordered) allMet = false;
  }
  if (!anyReceived) return 'issued';
  if (allMet) return 'received';
  return 'partially_received';
}

/**
 * Insert a receipt + its lines, bump per-line quantity_received, recompute
 * the PO header status. Returns the inserted receipt id.
 *
 * Note: caller is responsible for verifying the PO belongs to the active
 * company before calling (we re-check inside the txn as a safety net).
 */
export async function createPoReceipt(
  companyId: string,
  poId: string,
  input: CreatePoReceiptInput,
): Promise<{ id: string; resultingStatus: PurchaseOrder['status'] }> {
  const db = requireDb();

  return await db.transaction(async (tx) => {
    // Re-verify ownership inside the txn so a concurrent re-parent (rare)
    // can't slip through. Also fetch current status — we only auto-advance
    // from issued / partially_received / received, never from draft / closed
    // / void.
    const poRows = await tx
      .select({ id: purchaseOrders.id, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.id, poId), eq(purchaseOrders.companyId, companyId)),
      )
      .limit(1);
    const po = poRows[0];
    if (!po) {
      throw new Error('Purchase order not found in active company.');
    }
    if (po.status === 'draft') {
      throw new Error('Cannot receive against a draft PO — issue it first.');
    }
    if (po.status === 'void' || po.status === 'closed') {
      throw new Error(`Cannot receive against a ${po.status} PO.`);
    }

    // Insert receipt header.
    const insertedReceipt = await tx
      .insert(poReceipts)
      .values({
        purchaseOrderId: poId,
        receivedAt: input.receivedAt,
        receivedByUserId: input.receivedByUserId,
        notes: input.notes,
      })
      .returning({ id: poReceipts.id });
    const receiptId = insertedReceipt[0].id;

    // Filter out zero-qty rows so users can leave lines blank in the form
    // without polluting the audit trail.
    const nonZeroLines = input.lines.filter((l) => l.quantityReceived > 0);

    if (nonZeroLines.length > 0) {
      const insertedReceiptLines = await tx
        .insert(poReceiptLines)
        .values(
          nonZeroLines.map((l) => ({
            receiptId,
            poLineId: l.poLineId,
            quantityReceived: l.quantityReceived.toFixed(4),
          })),
        )
        .returning({ id: poReceiptLines.id, poLineId: poReceiptLines.poLineId });

      // Bump per-line quantity_received in one statement each. Small N
      // (lines per PO), so the per-row update is fine.
      for (const l of nonZeroLines) {
        await tx
          .update(purchaseOrderLines)
          .set({
            quantityReceived: sql`${purchaseOrderLines.quantityReceived} + ${l.quantityReceived.toFixed(4)}`,
          })
          .where(eq(purchaseOrderLines.id, l.poLineId));
      }

      // Phase 6.3: write inventory ledger movements for the subset of
      // received lines whose PO line references an inventory item. Free-text
      // PO lines (no inventory_item_id) don't generate stock movements —
      // they're cost-only.
      const poLineIds = nonZeroLines.map((l) => l.poLineId);
      const linkedPoLines = await tx
        .select({
          id: purchaseOrderLines.id,
          inventoryItemId: purchaseOrderLines.inventoryItemId,
        })
        .from(purchaseOrderLines)
        .where(
          and(
            inArray(purchaseOrderLines.id, poLineIds),
            isNotNull(purchaseOrderLines.inventoryItemId),
          ),
        );
      const itemByPoLine = new Map<string, string>();
      for (const pl of linkedPoLines) {
        if (pl.inventoryItemId) itemByPoLine.set(pl.id, pl.inventoryItemId);
      }

      const movementRows = [];
      for (const rl of insertedReceiptLines) {
        const itemId = itemByPoLine.get(rl.poLineId);
        if (!itemId) continue;
        const qty = nonZeroLines.find((n) => n.poLineId === rl.poLineId)
          ?.quantityReceived;
        if (qty === undefined || qty <= 0) continue;
        movementRows.push({
          companyId,
          inventoryItemId: itemId,
          quantity: qty.toFixed(4),
          movementType: 'received' as const,
          occurredAt: input.receivedAt,
          createdByUserId: input.receivedByUserId,
          notes: null,
          poReceiptLineId: rl.id,
          projectId: null,
          reversalOfId: null,
        });
      }
      if (movementRows.length > 0) {
        await tx.insert(inventoryMovements).values(movementRows);
      }
    }

    // Recompute header status from the rolled-up line totals.
    const refreshedLines = await tx
      .select({
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, poId));
    const newStatus = computePoStatusFromLines(refreshedLines);

    if (newStatus !== po.status) {
      await tx
        .update(purchaseOrders)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, poId));
    }

    return { id: receiptId, resultingStatus: newStatus };
  });
}

/**
 * List all receipts on a PO, newest first, each with its line breakdown.
 */
export async function listPoReceiptsForPO(
  poId: string,
): Promise<PoReceiptWithLines[]> {
  const db = requireDb();
  const receipts = await db
    .select()
    .from(poReceipts)
    .where(eq(poReceipts.purchaseOrderId, poId))
    .orderBy(desc(poReceipts.receivedAt));
  if (receipts.length === 0) return [];

  const lines = await db
    .select()
    .from(poReceiptLines)
    .where(inArray(poReceiptLines.receiptId, receipts.map((r) => r.id)))
    .orderBy(asc(poReceiptLines.id));

  return receipts.map((r) => ({
    id: r.id,
    purchaseOrderId: r.purchaseOrderId,
    receivedAt: r.receivedAt,
    receivedByUserId: r.receivedByUserId,
    notes: r.notes,
    lines: lines
      .filter((l) => l.receiptId === r.id)
      .map((l) => ({
        id: l.id,
        poLineId: l.poLineId,
        quantityReceived: l.quantityReceived,
      })),
  }));
}

/**
 * Reverse a receipt — decrement the per-line totals, delete the rows,
 * recompute PO status. Used by the "undo" action on the receipt history.
 */
export async function deletePoReceipt(
  companyId: string,
  receiptId: string,
): Promise<{ poId: string; resultingStatus: PurchaseOrder['status'] }> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const receiptRows = await tx
      .select({
        id: poReceipts.id,
        poId: poReceipts.purchaseOrderId,
      })
      .from(poReceipts)
      .innerJoin(
        purchaseOrders,
        eq(purchaseOrders.id, poReceipts.purchaseOrderId),
      )
      .where(
        and(
          eq(poReceipts.id, receiptId),
          eq(purchaseOrders.companyId, companyId),
        ),
      )
      .limit(1);
    const receipt = receiptRows[0];
    if (!receipt) {
      throw new Error('Receipt not found in active company.');
    }

    const lineRows = await tx
      .select()
      .from(poReceiptLines)
      .where(eq(poReceiptLines.receiptId, receiptId));

    for (const l of lineRows) {
      await tx
        .update(purchaseOrderLines)
        .set({
          quantityReceived: sql`${purchaseOrderLines.quantityReceived} - ${l.quantityReceived}`,
        })
        .where(eq(purchaseOrderLines.id, l.poLineId));
    }

    // Phase 6.3: write reversal movements BEFORE the cascade fires, so the
    // ledger SUM goes back to zero (original +qty + reversal -qty) and the
    // history shows both rows. The ON DELETE SET NULL on po_receipt_line_id
    // means the original row stays in the ledger after the cascade, with its
    // source link nulled out — reversal_of_id still points at it.
    if (lineRows.length > 0) {
      const originals = await tx
        .select()
        .from(inventoryMovements)
        .where(
          inArray(
            inventoryMovements.poReceiptLineId,
            lineRows.map((l) => l.id),
          ),
        );
      if (originals.length > 0) {
        await tx.insert(inventoryMovements).values(
          originals.map((m) => ({
            companyId: m.companyId,
            inventoryItemId: m.inventoryItemId,
            quantity: `-${m.quantity}`,
            movementType: m.movementType,
            occurredAt: new Date(),
            createdByUserId: null,
            notes: 'Reversal — receipt undone',
            poReceiptLineId: null,
            projectId: null,
            reversalOfId: m.id,
          })),
        );
      }
    }

    // Cascading delete on receipt_lines via FK ON DELETE CASCADE; the
    // inventory_movements.po_receipt_line_id FK is SET NULL so originals
    // survive with a null source link (see Phase 6.3 reversal above).
    await tx.delete(poReceipts).where(eq(poReceipts.id, receiptId));

    const refreshedLines = await tx
      .select({
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, receipt.poId));
    const newStatus = computePoStatusFromLines(refreshedLines);

    await tx
      .update(purchaseOrders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, receipt.poId));

    return { poId: receipt.poId, resultingStatus: newStatus };
  });
}
