// Data layer for receipts + receipt_attachments. DB-only — no mock-store
// fallback (matches the pattern in lib/data/banking-rules.ts and
// lib/data/statement-imports.ts).

import 'server-only';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  receipts,
  receiptLines,
  receiptAttachments,
  type Receipt,
  type NewReceipt,
  type ReceiptLine,
  type NewReceiptLine,
  type ReceiptAttachment,
  type NewReceiptAttachment,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class ReceiptsNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Receipts require a configured database. Set DATABASE_URL and apply the receipts-phase1 migration to use this module.',
    );
    this.name = 'ReceiptsNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new ReceiptsNotAvailableInDemoError();
  return getDb()!;
}

export type ListReceiptsFilters = {
  /** Project filter matches via receipt_lines (Phase 2.1+). A receipt is
   *  included if it has at least one non-deleted line with this project_id. */
  projectId?: string;
  status?: Receipt['status'];
  vendorId?: string;
  /** ISO YYYY-MM-DD bounds, inclusive. */
  dateFrom?: string;
  dateTo?: string;
  /** Gross-total bounds, inclusive. */
  amountMin?: number;
  amountMax?: number;
  limit?: number;
};

export async function listReceipts(
  companyId: string,
  filters: ListReceiptsFilters = {},
): Promise<Receipt[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds: SQL[] = [
    eq(receipts.companyId, companyId),
    isNull(receipts.deletedAt),
  ];
  if (filters.status) conds.push(eq(receipts.status, filters.status));
  if (filters.vendorId) conds.push(eq(receipts.vendorId, filters.vendorId));
  if (filters.dateFrom) conds.push(gte(receipts.receiptDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(receipts.receiptDate, filters.dateTo));
  if (filters.amountMin !== undefined && Number.isFinite(filters.amountMin)) {
    conds.push(gte(receipts.total, filters.amountMin.toFixed(2)));
  }
  if (filters.amountMax !== undefined && Number.isFinite(filters.amountMax)) {
    conds.push(lte(receipts.total, filters.amountMax.toFixed(2)));
  }
  if (filters.projectId) {
    // Sub-select receipt_ids that have a line on this project, then filter
    // the outer query by inArray. Avoids a JOIN that would duplicate header
    // rows when a receipt has multiple matching lines.
    const matchedIds = await db
      .selectDistinct({ receiptId: receiptLines.receiptId })
      .from(receiptLines)
      .where(
        and(
          eq(receiptLines.companyId, companyId),
          eq(receiptLines.projectId, filters.projectId),
          isNull(receiptLines.deletedAt),
        ),
      );
    if (matchedIds.length === 0) return [];
    conds.push(
      inArray(
        receipts.id,
        matchedIds.map((r) => r.receiptId),
      ),
    );
  }
  return await db
    .select()
    .from(receipts)
    .where(and(...conds))
    .orderBy(desc(receipts.receiptDate), desc(receipts.createdAt))
    .limit(filters.limit ?? 200);
}

export async function getReceipt(
  companyId: string,
  id: string,
): Promise<Receipt | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.id, id),
        eq(receipts.companyId, companyId),
        isNull(receipts.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createReceipt(input: NewReceipt): Promise<Receipt> {
  const db = requireDb();
  const [row] = await db.insert(receipts).values(input).returning();
  return row;
}

export type UpdateReceiptPatch = Partial<
  Pick<
    Receipt,
    | 'projectId'
    | 'costCodeId'
    | 'vendorId'
    | 'accountingAccountId'
    | 'paymentSourceType'
    | 'bankAccountId'
    | 'receiptDate'
    | 'currency'
    | 'subtotal'
    | 'vatAmount'
    | 'total'
    | 'vatRatePercent'
    | 'vatIncluded'
    | 'vatRecoverable'
    | 'vatPeriodQuarter'
    | 'vendorTin'
    | 'costType'
    | 'status'
    | 'postedAt'
    | 'postedJobCostEntryId'
    | 'submittedAt'
    | 'submittedByUserId'
    | 'approvedAt'
    | 'approvedByUserId'
    | 'rejectionReason'
    | 'isBillable'
    | 'isReimbursable'
    | 'notes'
  >
>;

export async function updateReceipt(
  companyId: string,
  id: string,
  patch: UpdateReceiptPatch,
): Promise<Receipt | undefined> {
  const db = requireDb();
  const rows = await db
    .update(receipts)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(receipts.id, id),
        eq(receipts.companyId, companyId),
        isNull(receipts.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function softDeleteReceipt(
  companyId: string,
  id: string,
): Promise<Receipt | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(receipts)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(receipts.id, id),
        eq(receipts.companyId, companyId),
        isNull(receipts.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

// ===== Lines (Phase 2.1) =====
//
// A receipt has 1..N lines. A line carries project / cost code / cost type /
// accounting account / amounts / billable / reimbursable. Posting writes one
// job_cost_entries row per line; the link is captured in line.postedJobCostEntryId.
//
// The header's subtotal/vatAmount/total are a denormalized sum of line totals
// — call recalcReceiptHeaderTotals after any mutation that changes line money.

export async function listReceiptLines(
  companyId: string,
  receiptId: string,
): Promise<ReceiptLine[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(receiptLines)
    .where(
      and(
        eq(receiptLines.companyId, companyId),
        eq(receiptLines.receiptId, receiptId),
        isNull(receiptLines.deletedAt),
      ),
    )
    .orderBy(asc(receiptLines.sortOrder), asc(receiptLines.createdAt));
}

/** Bulk fetch lines for many receipts (list page). Returns rows in no
 *  particular order — caller groups by receiptId. */
export async function listReceiptLinesForReceiptIds(
  companyId: string,
  receiptIds: string[],
): Promise<ReceiptLine[]> {
  if (!isDatabaseConfigured() || receiptIds.length === 0) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(receiptLines)
    .where(
      and(
        eq(receiptLines.companyId, companyId),
        inArray(receiptLines.receiptId, receiptIds),
        isNull(receiptLines.deletedAt),
      ),
    );
}

export async function createReceiptLine(
  input: NewReceiptLine,
): Promise<ReceiptLine> {
  const db = requireDb();
  const [row] = await db.insert(receiptLines).values(input).returning();
  return row;
}

export type UpdateReceiptLinePatch = Partial<
  Pick<
    ReceiptLine,
    | 'sortOrder'
    | 'projectId'
    | 'costCodeId'
    | 'accountingAccountId'
    | 'costType'
    | 'description'
    | 'subtotal'
    | 'vatAmount'
    | 'total'
    | 'vatRatePercent'
    | 'isBillable'
    | 'isReimbursable'
    | 'paidByUserId'
    | 'reimbursementPayoutId'
    | 'postedJobCostEntryId'
  >
>;

export async function updateReceiptLine(
  companyId: string,
  id: string,
  patch: UpdateReceiptLinePatch,
): Promise<ReceiptLine | undefined> {
  const db = requireDb();
  const rows = await db
    .update(receiptLines)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(receiptLines.id, id),
        eq(receiptLines.companyId, companyId),
        isNull(receiptLines.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

export async function softDeleteReceiptLine(
  companyId: string,
  id: string,
): Promise<ReceiptLine | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(receiptLines)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(receiptLines.id, id),
        eq(receiptLines.companyId, companyId),
        isNull(receiptLines.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

/** Recompute and persist receipt header totals as the sum of its non-deleted
 *  lines. Returns the updated receipt or undefined if not found. */
export async function recalcReceiptHeaderTotals(
  companyId: string,
  receiptId: string,
): Promise<Receipt | undefined> {
  const db = requireDb();
  const lines = await listReceiptLines(companyId, receiptId);
  let subtotal = 0;
  let vat = 0;
  let total = 0;
  for (const l of lines) {
    subtotal += Number(l.subtotal);
    vat += Number(l.vatAmount);
    total += Number(l.total);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return await updateReceipt(companyId, receiptId, {
    subtotal: round(subtotal).toFixed(2),
    vatAmount: round(vat).toFixed(2),
    total: round(total).toFixed(2),
  });
}

// ===== Attachments =====

export async function listReceiptAttachments(
  companyId: string,
  receiptId: string,
): Promise<ReceiptAttachment[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(receiptAttachments)
    .where(
      and(
        eq(receiptAttachments.companyId, companyId),
        eq(receiptAttachments.receiptId, receiptId),
        isNull(receiptAttachments.deletedAt),
      ),
    )
    .orderBy(desc(receiptAttachments.uploadedAt));
}

/**
 * Count live attachments for many receipts at once. Returns a Map keyed by
 * receiptId (only receipts with ≥1 attachment appear). Used to badge bank
 * transactions with how many receipt files are attached, without loading
 * every attachment row.
 */
export async function countAttachmentsByReceiptIds(
  companyId: string,
  receiptIds: string[],
): Promise<Map<string, number>> {
  if (!isDatabaseConfigured() || receiptIds.length === 0) return new Map();
  const db = getDb()!;
  const rows = await db
    .select({
      receiptId: receiptAttachments.receiptId,
      n: sql<number>`count(*)::int`,
    })
    .from(receiptAttachments)
    .where(
      and(
        eq(receiptAttachments.companyId, companyId),
        inArray(receiptAttachments.receiptId, receiptIds),
        isNull(receiptAttachments.deletedAt),
      ),
    )
    .groupBy(receiptAttachments.receiptId);
  return new Map(rows.map((r) => [r.receiptId, Number(r.n)]));
}

export async function createReceiptAttachment(
  input: NewReceiptAttachment,
): Promise<ReceiptAttachment> {
  const db = requireDb();
  const [row] = await db
    .insert(receiptAttachments)
    .values(input)
    .returning();
  return row;
}

export async function softDeleteReceiptAttachment(
  companyId: string,
  id: string,
): Promise<ReceiptAttachment | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(receiptAttachments)
    .set({ deletedAt: now })
    .where(
      and(
        eq(receiptAttachments.id, id),
        eq(receiptAttachments.companyId, companyId),
        isNull(receiptAttachments.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}
