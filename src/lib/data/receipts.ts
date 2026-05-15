// Data layer for receipts + receipt_attachments. DB-only — no mock-store
// fallback (matches the pattern in lib/data/banking-rules.ts and
// lib/data/statement-imports.ts).

import 'server-only';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import {
  receipts,
  receiptAttachments,
  type Receipt,
  type NewReceipt,
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
  projectId?: string;
  status?: Receipt['status'];
  vendorId?: string;
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
  if (filters.projectId) conds.push(eq(receipts.projectId, filters.projectId));
  if (filters.status) conds.push(eq(receipts.status, filters.status));
  if (filters.vendorId) conds.push(eq(receipts.vendorId, filters.vendorId));
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
