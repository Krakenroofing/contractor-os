// 3-way match (roadmap P3): a bill line raised against a GR/IR purchase
// order line is compared with the PO (price) and the goods receipts
// (quantity). Outside tolerance → the bill posts but is blocked for payment
// until an approver releases it.
//
// Tolerances live on the company:
//   - quantity: cumulative billed qty (all posted bills incl. this one) may
//     exceed the received qty by at most match_qty_tolerance_pct %.
//   - price: a billed unit price off the PO price by more than
//     match_price_tolerance_pct % AND more than match_price_tolerance_amount
//     dollars on the line is a price mismatch (small rounding never blocks).

import 'server-only';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { receiptLines, receipts, type Receipt, type ReceiptLine } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { getPurchaseOrder, getPurchaseOrderLines } from '@/lib/data/purchase-orders';

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export type MatchTolerances = {
  qtyPct: number;
  pricePct: number;
  priceAmount: number;
};

export function tolerancesOf(company: {
  matchQtyTolerancePct: string;
  matchPriceTolerancePct: string;
  matchPriceToleranceAmount: string;
}): MatchTolerances {
  return {
    qtyPct: Number(company.matchQtyTolerancePct) || 0,
    pricePct: Number(company.matchPriceTolerancePct) || 0,
    priceAmount: Number(company.matchPriceToleranceAmount) || 0,
  };
}

export type BillMatchLine = {
  receiptLineId: string;
  poLineId: string;
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  /** Billed on OTHER posted bills for this PO line. */
  quantityBilledElsewhere: number;
  quantityBilled: number | null;
  poUnitCost: number;
  billedUnitCost: number | null;
  billedAmount: number;
  /** billed qty × PO price — what this line clears from GR/IR. */
  grirAmount: number;
  priceVariance: number;
  qtyIssue: string | null;
  priceIssue: string | null;
};

export type BillMatchResult = {
  /** False for bills not raised from a GR/IR PO — nothing to match. */
  applies: boolean;
  poNumber: string | null;
  lines: BillMatchLine[];
  issues: string[];
};

const fmtQty = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 4 });
const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

/** Quantity already billed per PO line on posted bills other than `excludeReceiptId`. */
async function billedQtyElsewhere(
  companyId: string,
  poLineIds: string[],
  excludeReceiptId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!isDatabaseConfigured() || poLineIds.length === 0) return out;
  const db = getDb()!;
  const rows = await db
    .select({
      poLineId: receiptLines.purchaseOrderLineId,
      qty: sql<string>`COALESCE(SUM(${receiptLines.quantity}), 0)`,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(
      and(
        eq(receipts.companyId, companyId),
        eq(receipts.status, 'posted'),
        isNull(receipts.deletedAt),
        isNull(receiptLines.deletedAt),
        ne(receipts.id, excludeReceiptId),
        inArray(receiptLines.purchaseOrderLineId, poLineIds),
      ),
    )
    .groupBy(receiptLines.purchaseOrderLineId);
  for (const r of rows) {
    if (r.poLineId) out.set(r.poLineId, Number(r.qty));
  }
  return out;
}

export async function analyzeBillMatch(
  companyId: string,
  receipt: Pick<Receipt, 'id' | 'purchaseOrderId'>,
  lines: ReceiptLine[],
  tol: MatchTolerances,
): Promise<BillMatchResult> {
  const none: BillMatchResult = { applies: false, poNumber: null, lines: [], issues: [] };
  if (!receipt.purchaseOrderId) return none;
  const po = await getPurchaseOrder(companyId, receipt.purchaseOrderId);
  if (!po || !po.grir) return none;
  const poLines = await getPurchaseOrderLines(po.id);
  const poLineById = new Map(poLines.map((l) => [l.id, l]));
  const matched = lines.filter(
    (l) => l.purchaseOrderLineId && poLineById.has(l.purchaseOrderLineId),
  );
  const elsewhere = await billedQtyElsewhere(
    companyId,
    [...new Set(matched.map((l) => l.purchaseOrderLineId!))],
    receipt.id,
  );

  // Several bill lines can point at one PO line — quantity is checked on
  // the running total, in line order.
  const runningQty = new Map<string, number>();
  const out: BillMatchLine[] = [];
  const issues: string[] = [];
  for (const l of matched) {
    const pl = poLineById.get(l.purchaseOrderLineId!)!;
    const poUnit = Number(pl.unitCost);
    const billed = round2(Number(l.subtotal));
    const qty =
      l.quantity !== null
        ? Number(l.quantity)
        : poUnit !== 0
          ? round4(billed / poUnit)
          : null;
    const grirAmount = qty !== null ? round2(qty * poUnit) : billed;
    const variance = round2(billed - grirAmount);
    const billedUnit = qty ? billed / qty : null;
    const label = (l.description ?? pl.description).slice(0, 60);

    let priceIssue: string | null = null;
    const pctOff =
      billedUnit !== null && poUnit !== 0
        ? (Math.abs(billedUnit - poUnit) / Math.abs(poUnit)) * 100
        : variance !== 0
          ? Infinity
          : 0;
    if (pctOff > tol.pricePct + 1e-9 && Math.abs(variance) > tol.priceAmount + 1e-9) {
      priceIssue = `billed ${billedUnit !== null ? fmtMoney(billedUnit) : fmtMoney(billed)} vs PO ${fmtMoney(poUnit)} (${variance > 0 ? '+' : ''}${fmtMoney(variance)} on the line)`;
      issues.push(`“${label}”: price ${priceIssue}`);
    }

    const before =
      runningQty.get(pl.id) ?? elsewhere.get(pl.id) ?? 0;
    const cum = round4(before + (qty ?? 0));
    runningQty.set(pl.id, cum);
    const received = Number(pl.quantityReceived);
    let qtyIssue: string | null = null;
    if (qty !== null && qty > 0 && cum > received * (1 + tol.qtyPct / 100) + 1e-6) {
      qtyIssue =
        received <= 0
          ? `billed ${fmtQty(cum)}, nothing received yet`
          : `billed ${fmtQty(cum)} vs received ${fmtQty(received)}`;
      issues.push(`“${label}”: quantity ${qtyIssue}`);
    }

    out.push({
      receiptLineId: l.id,
      poLineId: pl.id,
      description: l.description ?? pl.description,
      quantityOrdered: Number(pl.quantityOrdered),
      quantityReceived: received,
      quantityBilledElsewhere: elsewhere.get(pl.id) ?? 0,
      quantityBilled: qty,
      poUnitCost: poUnit,
      billedUnitCost: billedUnit,
      billedAmount: billed,
      grirAmount,
      priceVariance: variance,
      qtyIssue,
      priceIssue,
    });
  }
  return { applies: true, poNumber: po.number, lines: out, issues };
}
