// Idempotent backfill / reconciliation for invoice payment state.
//
// Mirrors `migrations/2026-05-07_phase2_invoice_reconciliation_backfill.sql`
// in TypeScript so it can run in dev (mock store) and as a one-shot script
// or admin button. Production should use the SQL migration directly — it's
// faster and atomic — but this helper exists for the cases where the SQL
// can't be run (test data, dev-mode resets, demo flows).

import 'server-only';
import { eq } from 'drizzle-orm';
import { invoices, invoicePayments, type Invoice } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { recomputeInvoicePaymentState } from '@/lib/data/invoice-payments';
import { sumAppliedPayments } from '@/modules/invoices/lib/financials';
import {
  createMockPayment,
  DuplicatePaymentNumberError,
  getMockInvoicePayments,
  listMockInvoices,
  recomputeInvoicePaymentStateInMemory,
} from '@/lib/mock-store';

export type ReconcileReport = {
  invoicesScanned: number;
  backfillPaymentsInserted: number;
  invoicesUpdated: number;
  invoicesAlreadyConsistent: number;
};

const BACKFILL_METHOD = 'backfill_reconcile';

function backfillPaymentNumber(invoiceNumber: string): string {
  return `BACKFILL-${invoiceNumber}`;
}

/**
 * Reconcile every non-void invoice for the given company:
 *   1. Insert at most one balancing payment per invoice that needs one
 *      (idempotent via `payment_number = 'BACKFILL-<invoice number>'`).
 *   2. Recompute amount_paid / status / paid_at from payment rows.
 *
 * Safe to run repeatedly. Returns a summary so the caller can show what
 * changed.
 */
export async function reconcileAllInvoices(
  companyId: string,
): Promise<ReconcileReport> {
  if (isDatabaseConfigured()) {
    return reconcileDb(companyId);
  }
  return reconcileMock(companyId);
}

async function reconcileDb(companyId: string): Promise<ReconcileReport> {
  const db = getDb()!;
  const invs = await db
    .select()
    .from(invoices)
    .where(eq(invoices.companyId, companyId));

  let inserted = 0;
  let updated = 0;
  let consistent = 0;

  for (const inv of invs) {
    if (inv.status === 'void') {
      consistent++;
      continue;
    }
    const existingPayments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, inv.id));
    const recordedPaid = sumAppliedPayments(existingPayments);
    const cachedPaid = Number(inv.amountPaid);
    const total = Number(inv.total);

    // Reconcile to whichever target is larger: the cached `amount_paid`
    // (preserves the user's intent of "this invoice was paid") OR, if
    // status='paid', the full total (the cache may itself be stale).
    const targetPaid =
      inv.status === 'paid' ? Math.max(cachedPaid, total) : cachedPaid;
    const gap = targetPaid - recordedPaid;
    const hasBackfillAlready = existingPayments.some(
      (p) => p.paymentNumber === backfillPaymentNumber(inv.number),
    );

    if (gap > 0.005 && !hasBackfillAlready) {
      await db.insert(invoicePayments).values({
        invoiceId: inv.id,
        paymentNumber: backfillPaymentNumber(inv.number),
        paidDate: inv.invoiceDate,
        amount: gap.toFixed(2),
        method: BACKFILL_METHOD,
        reference: null,
        bankAccount: null,
        status: 'received',
        notes:
          'Auto-recorded by reconciliation backfill. ' +
          'See @/lib/data/invoice-reconcile.ts.',
      });
      inserted++;
    }

    const before = snapshotState(inv);
    await recomputeInvoicePaymentState(inv.id);
    const after = (
      await db.select().from(invoices).where(eq(invoices.id, inv.id)).limit(1)
    )[0];
    if (stateChanged(before, snapshotState(after))) updated++;
    else if (gap <= 0.005) consistent++;
  }

  return {
    invoicesScanned: invs.length,
    backfillPaymentsInserted: inserted,
    invoicesUpdated: updated,
    invoicesAlreadyConsistent: consistent,
  };
}

function reconcileMock(companyId: string): ReconcileReport {
  const allInvoices = listMockInvoices(companyId);
  let inserted = 0;
  let updated = 0;
  let consistent = 0;

  for (const inv of allInvoices) {
    if (inv.status === 'void') {
      consistent++;
      continue;
    }

    const existing = getMockInvoicePayments(inv.id);
    const recordedPaid = sumAppliedPayments(existing);
    const cachedPaid = Number(inv.amountPaid);
    const total = Number(inv.total);
    const targetPaid =
      inv.status === 'paid' ? Math.max(cachedPaid, total) : cachedPaid;
    const gap = targetPaid - recordedPaid;

    if (gap > 0.005) {
      try {
        // createMockPayment runs `recomputeInvoicePaymentState` for us. If
        // a backfill row already exists, it throws DuplicatePaymentNumberError
        // — which we treat as "already reconciled, skip".
        createMockPayment(companyId, {
          invoiceId: inv.id,
          paymentNumber: backfillPaymentNumber(inv.number),
          paidDate: inv.invoiceDate,
          amount: gap.toFixed(2),
          method: BACKFILL_METHOD,
          reference: null,
          bankAccount: null,
          status: 'received',
          notes:
            'Auto-recorded by reconciliation backfill. ' +
            'See @/lib/data/invoice-reconcile.ts.',
        });
        inserted++;
      } catch (err) {
        if (!(err instanceof DuplicatePaymentNumberError)) throw err;
      }
    }

    const before = snapshotState(inv);
    recomputeInvoicePaymentStateInMemory(inv.id);
    const after = listMockInvoices(companyId).find((x) => x.id === inv.id)!;
    if (stateChanged(before, snapshotState(after))) updated++;
    else if (gap <= 0.005) consistent++;
  }

  return {
    invoicesScanned: allInvoices.length,
    backfillPaymentsInserted: inserted,
    invoicesUpdated: updated,
    invoicesAlreadyConsistent: consistent,
  };
}

type StateSnapshot = {
  amountPaid: string;
  status: string;
};

function snapshotState(inv: Invoice): StateSnapshot {
  // We deliberately ignore `paidAt` and `updatedAt` here: recomputeInvoicePaymentState
  // always bumps them on a 'paid' invoice (NOW()), so including them would
  // make every re-run report `updated > 0`. The numbers + status are what
  // actually drive the dashboard.
  return {
    amountPaid: Number(inv.amountPaid).toFixed(2),
    status: inv.status,
  };
}

function stateChanged(a: StateSnapshot, b: StateSnapshot): boolean {
  return a.amountPaid !== b.amountPaid || a.status !== b.status;
}
