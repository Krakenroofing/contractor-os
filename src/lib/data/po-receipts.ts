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
// Cost recognition depends on the PO (roadmap P3, GR/IR):
//   - GR/IR POs (dated on/after the company's cutover): each received line
//     posts a job_cost_entries row (source 'po_receipt', valued at the PO
//     price) — the GL side is Dr expense / Cr GR/IR clearing, derived from
//     those rows. The vendor bill later clears GR/IR.
//   - Legacy POs: receiving posts no cost; the vendor bill carries it.

import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  inventoryMovements,
  jobCostEntries,
  poReceipts,
  poReceiptLines,
  purchaseOrderLines,
  purchaseOrders,
  vendors,
  type PurchaseOrder,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { resolvePoLineAccounts } from '@/lib/data/vendor-item-numbers';

export type CreatePoReceiptInput = {
  receivedAt: Date;
  /** The receiving day (YYYY-MM-DD) — the goods-receipt posting date. */
  receivedDate: string;
  receivedByUserId: string | null;
  notes: string | null;
  // Phase 6.4: which physical location received this shipment. All
  // inventory_movements written by this receipt inherit this value.
  // Nullable in the schema for legacy data; new writes always pass it.
  locationId: string | null;
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
    unitCost: string | null;
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
): Promise<{
  id: string;
  resultingStatus: PurchaseOrder['status'];
  grir: boolean;
}> {
  const db = requireDb();

  return await db.transaction(async (tx) => {
    // Re-verify ownership inside the txn so a concurrent re-parent (rare)
    // can't slip through. Also fetch current status — we only auto-advance
    // from issued / partially_received / received, never from draft / closed
    // / void.
    const poRows = await tx
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        grir: purchaseOrders.grir,
        number: purchaseOrders.number,
        projectId: purchaseOrders.projectId,
        vendorId: purchaseOrders.vendorId,
      })
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
        locationId: input.locationId,
      })
      .returning({ id: poReceipts.id });
    const receiptId = insertedReceipt[0].id;

    // Filter out zero-qty rows so users can leave lines blank in the form
    // without polluting the audit trail.
    const nonZeroLines = input.lines.filter((l) => l.quantityReceived > 0);

    if (nonZeroLines.length > 0) {
      const poLineRows = await tx
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, poId),
            inArray(
              purchaseOrderLines.id,
              nonZeroLines.map((l) => l.poLineId),
            ),
          ),
        );
      const poLineById = new Map(poLineRows.map((l) => [l.id, l]));
      if (poLineById.size !== new Set(nonZeroLines.map((l) => l.poLineId)).size) {
        throw new Error('A received line is not on this purchase order.');
      }
      const insertedReceiptLines = await tx
        .insert(poReceiptLines)
        .values(
          nonZeroLines.map((l) => ({
            receiptId,
            poLineId: l.poLineId,
            quantityReceived: l.quantityReceived.toFixed(4),
            unitCost: poLineById.get(l.poLineId)!.unitCost,
          })),
        )
        .returning({ id: poReceiptLines.id, poLineId: poReceiptLines.poLineId });

      // GR/IR: the goods receipt recognizes the cost, valued at PO price.
      if (po.grir) {
        const [vendor] = await tx
          .select({ accountId: vendors.defaultAccountingAccountId })
          .from(vendors)
          .where(eq(vendors.id, po.vendorId))
          .limit(1);
        const resolved = await resolvePoLineAccounts(
          companyId,
          po.vendorId,
          nonZeroLines.map((l) => {
            const pl = poLineById.get(l.poLineId)!;
            return {
              accountingAccountId: pl.accountingAccountId,
              inventoryItemId: pl.inventoryItemId,
            };
          }),
        );
        const accountByPoLine = new Map(
          nonZeroLines.map((l, i) => [l.poLineId, resolved[i]]),
        );
        const rows = nonZeroLines
          .map((l) => {
            const pl = poLineById.get(l.poLineId)!;
            const unitCost = Number(pl.unitCost);
            const amount = Math.round(l.quantityReceived * unitCost * 100) / 100;
            return { l, pl, unitCost, amount };
          })
          .filter((r) => r.amount !== 0)
          .map(({ l, pl, unitCost, amount }) => ({
            companyId,
            projectId: pl.projectId ?? po.projectId,
            costCodeId: pl.costCodeId,
            accountingAccountId: accountByPoLine.get(pl.id) ?? vendor?.accountId ?? null,
            source: 'po_receipt' as const,
            sourceRefId: receiptId,
            costType: 'materials' as const,
            entryDate: input.receivedDate,
            vendorId: po.vendorId,
            description: `Goods receipt ${po.number}: ${pl.description}`.slice(0, 500),
            quantity: l.quantityReceived.toFixed(4),
            unitCost: unitCost.toFixed(4),
            amount: amount.toFixed(2),
            isBillable: false,
            createdByUserId: input.receivedByUserId,
          }));
        if (rows.length > 0) await tx.insert(jobCostEntries).values(rows);
      }

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
          locationId: input.locationId,
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

    return { id: receiptId, resultingStatus: newStatus, grir: po.grir };
  });
}

/**
 * Link (or unlink) an inventory item on a PO line AFTER the fact — received
 * POs included, because the catalog often gets organized long after the
 * order shipped. Classification only: quantities, costs, and status never
 * change here.
 *
 * The stock ledger is kept consistent with the link: movements written by
 * this line's past receipts are reversed (they belong to the old item),
 * and when a new item is set, 'received' movements are written for every
 * already-received shipment of the line — so linking an item makes its
 * received quantity show up on hand retroactively.
 */
export async function setPoLineInventoryItem(
  companyId: string,
  poId: string,
  lineId: string,
  inventoryItemId: string | null,
  actorUserId: string | null,
): Promise<{ backfilledQty: number; reversedMovements: number }> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const poRows = await tx
      .select({ id: purchaseOrders.id, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.id, poId), eq(purchaseOrders.companyId, companyId)),
      )
      .limit(1);
    if (!poRows[0]) throw new Error('Purchase order not found in active company.');
    if (poRows[0].status === 'void')
      throw new Error('This PO is void — nothing to classify.');

    const lineRows = await tx
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.id, lineId),
          eq(purchaseOrderLines.purchaseOrderId, poId),
        ),
      )
      .limit(1);
    const line = lineRows[0];
    if (!line) throw new Error('Line not found on this PO.');
    if ((line.inventoryItemId ?? null) === inventoryItemId)
      return { backfilledQty: 0, reversedMovements: 0 };

    // This line's past shipments, with each receipt's date + location so
    // backfilled movements land where/when the goods actually arrived.
    const shipments = await tx
      .select({
        receiptLineId: poReceiptLines.id,
        quantityReceived: poReceiptLines.quantityReceived,
        receivedAt: poReceipts.receivedAt,
        locationId: poReceipts.locationId,
      })
      .from(poReceiptLines)
      .innerJoin(poReceipts, eq(poReceipts.id, poReceiptLines.receiptId))
      .where(eq(poReceiptLines.poLineId, lineId));

    // Reverse any movements the old item link produced (same pattern as
    // deletePoReceipt: +qty original + -qty reversal sums to zero).
    let reversedMovements = 0;
    if (shipments.length > 0) {
      const originals = await tx
        .select()
        .from(inventoryMovements)
        .where(
          inArray(
            inventoryMovements.poReceiptLineId,
            shipments.map((s) => s.receiptLineId),
          ),
        );
      // Skip originals a prior relink already reversed — reversing them
      // twice would drive the item's on-hand negative.
      const alreadyReversed = new Set(
        originals.length > 0
          ? (
              await tx
                .select({ reversalOfId: inventoryMovements.reversalOfId })
                .from(inventoryMovements)
                .where(
                  inArray(
                    inventoryMovements.reversalOfId,
                    originals.map((m) => m.id),
                  ),
                )
            ).map((r) => r.reversalOfId)
          : [],
      );
      const nonReversed = originals.filter(
        (m) => !m.quantity.startsWith('-') && !alreadyReversed.has(m.id),
      );
      if (nonReversed.length > 0) {
        await tx.insert(inventoryMovements).values(
          nonReversed.map((m) => ({
            companyId: m.companyId,
            inventoryItemId: m.inventoryItemId,
            quantity: `-${m.quantity}`,
            movementType: m.movementType,
            occurredAt: new Date(),
            createdByUserId: actorUserId,
            notes: 'Reversal — product link on the PO line changed',
            poReceiptLineId: null,
            projectId: null,
            reversalOfId: m.id,
            locationId: m.locationId,
          })),
        );
        reversedMovements = nonReversed.length;
      }
    }

    await tx
      .update(purchaseOrderLines)
      .set({ inventoryItemId })
      .where(eq(purchaseOrderLines.id, lineId));

    // Backfill 'received' movements for the new item across past shipments.
    let backfilledQty = 0;
    if (inventoryItemId && shipments.length > 0) {
      const rows = shipments
        .filter((s) => Number(s.quantityReceived) > 0)
        .map((s) => {
          backfilledQty += Number(s.quantityReceived);
          return {
            companyId,
            inventoryItemId,
            quantity: s.quantityReceived,
            movementType: 'received' as const,
            occurredAt: s.receivedAt,
            createdByUserId: actorUserId,
            notes: 'Backfill — product linked to the PO line after receiving',
            poReceiptLineId: s.receiptLineId,
            projectId: null,
            reversalOfId: null,
            locationId: s.locationId,
          };
        });
      if (rows.length > 0) await tx.insert(inventoryMovements).values(rows);
    }

    return { backfilledQty, reversedMovements };
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
        unitCost: l.unitCost,
      })),
  }));
}

/** Credit balance of the GR/IR clearing account in the GL — what the open
 *  items below should add up to. Null when the account doesn't exist yet. */
export async function grirGlBalance(companyId: string): Promise<number | null> {
  const db = requireDb();
  const rows = await db.execute(sql`
    SELECT COUNT(a.id)::int AS n,
           COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS balance
      FROM accounting_accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
     WHERE a.company_id = ${companyId}
       AND lower(trim(a.name)) = 'gr/ir clearing'
  `);
  const r = (rows as unknown as Array<{ n: number; balance: number }>)[0];
  if (!r || Number(r.n) === 0) return null;
  return Math.round(Number(r.balance) * 100) / 100;
}

/** GR/IR open items per PO line — received value (at the goods-receipt
 *  price) vs the value bills have cleared, for every GR/IR PO. Positive
 *  open = received, not yet billed; negative = billed, not yet received.
 *  The open total ties to the GR/IR clearing account balance. */
export type GrirOpenItem = {
  purchaseOrderId: string;
  poNumber: string;
  vendorId: string;
  projectId: string;
  poLineId: string;
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityBilled: number;
  receivedValue: number;
  clearedValue: number;
  open: number;
  lastReceivedAt: Date | null;
};

export async function listGrirOpenItems(
  companyId: string,
  opts: { includeSettled?: boolean } = {},
): Promise<GrirOpenItem[]> {
  const db = requireDb();
  const rows = await db.execute<{
    purchase_order_id: string;
    po_number: string;
    vendor_id: string;
    project_id: string;
    po_line_id: string;
    description: string;
    quantity_ordered: string;
    received_qty: string;
    received_value: string;
    last_received_at: Date | null;
    billed_qty: string;
    cleared_value: string;
  }>(sql`
    WITH rec AS (
      SELECT rl.po_line_id,
             SUM(rl.quantity_received) AS qty,
             SUM(ROUND(rl.quantity_received * COALESCE(rl.unit_cost, pl.unit_cost), 2)) AS value,
             MAX(r.received_at) AS last_at
        FROM po_receipt_lines rl
        JOIN po_receipts r ON r.id = rl.receipt_id
        JOIN purchase_order_lines pl ON pl.id = rl.po_line_id
       GROUP BY rl.po_line_id
    ), bil AS (
      SELECT l.purchase_order_line_id AS po_line_id,
             SUM(COALESCE(l.quantity, 0)) AS qty,
             SUM(l.grir_cleared_amount) AS value
        FROM receipt_lines l
        JOIN receipts b ON b.id = l.receipt_id
       WHERE b.company_id = ${companyId}
         AND b.status = 'posted' AND b.deleted_at IS NULL
         AND l.deleted_at IS NULL
         AND l.grir_cleared_amount IS NOT NULL
       GROUP BY l.purchase_order_line_id
    )
    SELECT po.id AS purchase_order_id, po.number AS po_number,
           po.vendor_id, COALESCE(pl.project_id, po.project_id) AS project_id,
           pl.id AS po_line_id, pl.description, pl.quantity_ordered,
           COALESCE(rec.qty, 0) AS received_qty,
           COALESCE(rec.value, 0) AS received_value,
           rec.last_at AS last_received_at,
           COALESCE(bil.qty, 0) AS billed_qty,
           COALESCE(bil.value, 0) AS cleared_value
      FROM purchase_orders po
      JOIN purchase_order_lines pl ON pl.purchase_order_id = po.id
      LEFT JOIN rec ON rec.po_line_id = pl.id
      LEFT JOIN bil ON bil.po_line_id = pl.id
     WHERE po.company_id = ${companyId}
       AND po.grir
       AND (rec.po_line_id IS NOT NULL OR bil.po_line_id IS NOT NULL)
     ORDER BY po.number, pl.sort_order
  `);
  const list = (rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const receivedValue = Number(r.received_value);
    const clearedValue = Number(r.cleared_value);
    return {
      purchaseOrderId: String(r.purchase_order_id),
      poNumber: String(r.po_number),
      vendorId: String(r.vendor_id),
      projectId: String(r.project_id),
      poLineId: String(r.po_line_id),
      description: String(r.description),
      quantityOrdered: Number(r.quantity_ordered),
      quantityReceived: Number(r.received_qty),
      quantityBilled: Number(r.billed_qty),
      receivedValue,
      clearedValue,
      open: Math.round((receivedValue - clearedValue) * 100) / 100,
      lastReceivedAt: (r.last_received_at as Date | null) ?? null,
    };
  });
  return opts.includeSettled ? list : list.filter((i) => i.open !== 0);
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
            // Inherit the original location so per-location SUM stays
            // balanced (original +qty + reversal -qty = 0 at that location).
            locationId: m.locationId,
          })),
        );
      }
    }

    // GR/IR: the goods receipt's cost goes with it (the caller re-syncs the
    // GL, which clears the matching Dr expense / Cr GR/IR entry).
    const now = new Date();
    await tx
      .update(jobCostEntries)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobCostEntries.companyId, companyId),
          eq(jobCostEntries.source, 'po_receipt'),
          eq(jobCostEntries.sourceRefId, receiptId),
          isNull(jobCostEntries.deletedAt),
        ),
      );

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
