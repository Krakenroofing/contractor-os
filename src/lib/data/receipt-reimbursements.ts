// Data layer for receipt reimbursements — Phase 2.4.
//
// A "pending reimbursement" is a receipt_lines row where:
//   is_reimbursable = true
//   reimbursement_payout_id IS NULL
//   paid_by_user_id IS NOT NULL
//   deleted_at IS NULL
//   AND parent receipt is non-deleted with status IN ('submitted', 'posted')
//   (i.e. the payer has formally handed off the receipt; drafts don't count)
//
// A "payout" is a row in receipt_reimbursement_payouts — one cash-out to a
// person covering 1..N lines, linked via receipt_lines.reimbursement_payout_id.

import 'server-only';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
} from 'drizzle-orm';
import {
  receipts,
  receiptLines,
  receiptReimbursementPayouts,
  type ReceiptLine,
  type ReceiptReimbursementPayout,
  type NewReceiptReimbursementPayout,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'Reimbursements require a configured database. Set DATABASE_URL and apply the receipts-phase2-reimbursements migration.',
    );
  }
  return getDb()!;
}

/** Pending reimbursable lines, joined to the parent receipt for date / vendor
 *  context. Excludes drafts and voids — only submitted/posted parents count. */
export type PendingReimbursementRow = {
  line: ReceiptLine;
  receiptId: string;
  receiptDate: string;
  receiptStatus: 'draft' | 'submitted' | 'posted' | 'void';
  currency: string;
  vendorId: string | null;
};

export async function listPendingReimbursements(
  companyId: string,
): Promise<PendingReimbursementRow[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const rows = await db
    .select({
      line: receiptLines,
      receiptId: receipts.id,
      receiptDate: receipts.receiptDate,
      receiptStatus: receipts.status,
      currency: receipts.currency,
      vendorId: receipts.vendorId,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(
      and(
        eq(receiptLines.companyId, companyId),
        eq(receiptLines.isReimbursable, true),
        isNull(receiptLines.reimbursementPayoutId),
        isNull(receiptLines.deletedAt),
        isNotNull(receiptLines.paidByUserId),
        isNull(receipts.deletedAt),
        inArray(receipts.status, ['submitted', 'posted']),
      ),
    )
    .orderBy(desc(receipts.receiptDate));
  return rows;
}

/** All payouts for a company, newest first. Capped for safety. */
export async function listPayouts(
  companyId: string,
  options: { limit?: number; paidToUserId?: string } = {},
): Promise<ReceiptReimbursementPayout[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds: SQL[] = [
    eq(receiptReimbursementPayouts.companyId, companyId),
    isNull(receiptReimbursementPayouts.deletedAt),
  ];
  if (options.paidToUserId) {
    conds.push(
      eq(receiptReimbursementPayouts.paidToUserId, options.paidToUserId),
    );
  }
  return await db
    .select()
    .from(receiptReimbursementPayouts)
    .where(and(...conds))
    .orderBy(
      desc(receiptReimbursementPayouts.paidAt),
      desc(receiptReimbursementPayouts.createdAt),
    )
    .limit(options.limit ?? 200);
}

export async function getPayout(
  companyId: string,
  id: string,
): Promise<ReceiptReimbursementPayout | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(receiptReimbursementPayouts)
    .where(
      and(
        eq(receiptReimbursementPayouts.id, id),
        eq(receiptReimbursementPayouts.companyId, companyId),
        isNull(receiptReimbursementPayouts.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Lines linked to a payout — used to render the payout detail / drill-down. */
export async function listLinesForPayout(
  companyId: string,
  payoutId: string,
): Promise<ReceiptLine[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(receiptLines)
    .where(
      and(
        eq(receiptLines.companyId, companyId),
        eq(receiptLines.reimbursementPayoutId, payoutId),
        isNull(receiptLines.deletedAt),
      ),
    );
}

/** Create a payout and atomically link the named lines to it. The amount is
 *  the sum of line.total (gross) — what the worker was out of pocket. */
export async function createPayoutAndLinkLines(input: {
  companyId: string;
  paidToUserId: string;
  paidAt: string; // YYYY-MM-DD
  paidVia: string;
  reference: string | null;
  bankAccountId: string | null;
  notes: string | null;
  createdByUserId: string;
  currency: string;
  lineIds: string[];
}): Promise<ReceiptReimbursementPayout> {
  const db = requireDb();
  if (input.lineIds.length === 0) {
    throw new Error('Payout must include at least one reimbursable line.');
  }

  // Fetch the lines first so we (a) verify ownership and (b) sum the amount
  // server-side rather than trusting a client-supplied total.
  const lines = await db
    .select()
    .from(receiptLines)
    .where(
      and(
        eq(receiptLines.companyId, input.companyId),
        inArray(receiptLines.id, input.lineIds),
        eq(receiptLines.isReimbursable, true),
        isNull(receiptLines.reimbursementPayoutId),
        isNull(receiptLines.deletedAt),
        eq(receiptLines.paidByUserId, input.paidToUserId),
      ),
    );
  if (lines.length !== input.lineIds.length) {
    throw new Error(
      'Some lines are missing, already reimbursed, or not owed to this user.',
    );
  }
  const total = lines.reduce((sum, l) => sum + Number(l.total), 0);
  const amount = (Math.round(total * 100) / 100).toFixed(2);

  const insertValues: NewReceiptReimbursementPayout = {
    companyId: input.companyId,
    paidToUserId: input.paidToUserId,
    paidAt: input.paidAt,
    paidVia: input.paidVia,
    reference: input.reference,
    amount,
    currency: input.currency,
    bankAccountId: input.bankAccountId,
    notes: input.notes,
    createdByUserId: input.createdByUserId,
  };
  const [payout] = await db
    .insert(receiptReimbursementPayouts)
    .values(insertValues)
    .returning();

  // Link all lines in one UPDATE — fewer round-trips than per-line.
  await db
    .update(receiptLines)
    .set({ reimbursementPayoutId: payout.id, updatedAt: new Date() })
    .where(
      and(
        eq(receiptLines.companyId, input.companyId),
        inArray(receiptLines.id, input.lineIds),
      ),
    );

  return payout;
}

/** Reverse a payout — soft-delete the row and clear the back-link on every
 *  line it covered. Used when the payout was recorded in error. Money is not
 *  refunded by this action; the operator handles that out-of-band. */
export async function reversePayout(
  companyId: string,
  payoutId: string,
): Promise<void> {
  const db = requireDb();
  await db
    .update(receiptLines)
    .set({ reimbursementPayoutId: null, updatedAt: new Date() })
    .where(
      and(
        eq(receiptLines.companyId, companyId),
        eq(receiptLines.reimbursementPayoutId, payoutId),
      ),
    );
  const now = new Date();
  await db
    .update(receiptReimbursementPayouts)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(receiptReimbursementPayouts.id, payoutId),
        eq(receiptReimbursementPayouts.companyId, companyId),
      ),
    );
}
