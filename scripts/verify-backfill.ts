// Verifies the backfill actually fixes the originally-reported bug:
// an invoice with status='paid' / amount_paid=total but ZERO payment rows
// (i.e. the legacy "Mark Paid" action that flipped status only) should
// reconcile to a single backfill payment row and the dashboard should drop
// it from outstanding AR.

import {
  KRAKEN_ID,
  listMockInvoices,
  getMockInvoicePayments,
} from '../src/lib/mock-store';
import { reconcileAllInvoices } from '../src/lib/data/invoice-reconcile';
import { buildDashboardData } from '../src/modules/dashboard/lib/dashboard';

function fmt(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  const asOf = new Date('2026-05-07T12:00:00Z');

  // Pick a sent unpaid invoice and corrupt its state to mimic a legacy
  // "Mark Paid" that didn't record a payment (the original bug).
  const target = listMockInvoices(KRAKEN_ID).find(
    (i) => i.status === 'sent' && Number(i.amountPaid) === 0,
  );
  if (!target) {
    console.error('No suitable sent invoice in seed.');
    process.exit(1);
  }
  const total = Number(target.total);
  console.log(
    `\nTarget: ${target.number} (total=${fmt(total)})`,
  );

  // Simulate the legacy bug: status='paid', amount_paid=total, no payment row.
  console.log('\nStep 1: corrupt to legacy bug state (status=paid, no payments)');
  target.status = 'paid';
  target.amountPaid = total.toFixed(2);
  target.paidAt = new Date('2026-05-01T12:00:00Z');
  // Confirm there are no payment rows yet.
  const paymentsBefore = getMockInvoicePayments(target.id);
  check(
    'invoice has zero payment rows before backfill',
    paymentsBefore.length === 0,
    `${paymentsBefore.length} found`,
  );

  // Build dashboard. Outstanding AR should now be wrong because the new
  // formula sums payment rows, not the cache: this invoice will appear in
  // outstanding AR as `total` even though status='paid'.
  const dashBuggy = await buildDashboardData(KRAKEN_ID, asOf);
  console.log(
    `  outstandingAR (buggy state) = ${fmt(dashBuggy.kpis.outstandingAR)}`,
  );

  // Run the backfill.
  console.log('\nStep 2: run reconcileAllInvoices');
  const report = await reconcileAllInvoices(KRAKEN_ID);
  console.log(
    `  scanned=${report.invoicesScanned}  ` +
      `backfilled=${report.backfillPaymentsInserted}  ` +
      `updated=${report.invoicesUpdated}`,
  );
  check(
    'exactly one backfill payment created',
    report.backfillPaymentsInserted === 1,
    `inserted=${report.backfillPaymentsInserted}`,
  );

  // Confirm the backfill row exists and matches the gap.
  const paymentsAfter = getMockInvoicePayments(target.id);
  const backfill = paymentsAfter.find((p) =>
    p.paymentNumber.startsWith('BACKFILL-'),
  );
  check('backfill payment row exists on the invoice', backfill !== undefined);
  if (backfill) {
    check(
      'backfill amount equals invoice total',
      Math.abs(Number(backfill.amount) - total) < 0.005,
      `${fmt(Number(backfill.amount))}`,
    );
    check(
      'backfill method is "backfill_reconcile"',
      backfill.method === 'backfill_reconcile',
      `${backfill.method}`,
    );
  }

  // Dashboard should now agree: outstanding drops by `total` for this invoice.
  const dashFixed = await buildDashboardData(KRAKEN_ID, asOf);
  console.log(
    `  outstandingAR (after backfill) = ${fmt(dashFixed.kpis.outstandingAR)}`,
  );
  check(
    'dashboard outstandingAR drops by invoice total after backfill',
    Math.abs(dashBuggy.kpis.outstandingAR - dashFixed.kpis.outstandingAR - total) <
      0.005,
    `${fmt(dashBuggy.kpis.outstandingAR - dashFixed.kpis.outstandingAR)} drop`,
  );

  // Idempotency: second run inserts nothing.
  console.log('\nStep 3: re-run backfill (must be idempotent)');
  const report2 = await reconcileAllInvoices(KRAKEN_ID);
  check(
    'second run inserts zero new backfill rows',
    report2.backfillPaymentsInserted === 0,
    `inserted=${report2.backfillPaymentsInserted}`,
  );
  check(
    'second run reports zero updates',
    report2.invoicesUpdated === 0,
    `updated=${report2.invoicesUpdated}`,
  );

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify-backfill crashed:', err);
  process.exit(1);
});
