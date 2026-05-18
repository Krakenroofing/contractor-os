// Smoke-test for the invoice/payment reconciliation fix.
//
// Runs in mock mode (no DATABASE_URL) so it exercises the in-memory store
// path. Walks the same scenarios the user asked about and prints PASS / FAIL
// for each one.
//
// Run:
//   npx tsx scripts/verify-ar-reconciliation.ts

import {
  KRAKEN_ID,
  computeProjectInvoiceSummary,
  createMockPayment,
  listMockInvoices,
  updateEntityStatus,
  recomputeInvoicePaymentStateInMemory,
} from '../src/lib/mock-store';
import { buildDashboardData } from '../src/modules/dashboard/lib/dashboard';
import { buildAgingRowsForCompany } from '../src/modules/accounts-receivable/lib/ar';

function fmt(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

let passed = 0;
let failed = 0;
function check(label: string, expected: number, actual: number, eps = 0.005) {
  const ok = Math.abs(expected - actual) < eps;
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}: ${fmt(actual)}`);
  } else {
    failed++;
    console.log(
      `  FAIL  ${label}: expected ${fmt(expected)}, got ${fmt(actual)}`,
    );
  }
}

async function main() {
  // Use a fixed asOf so overdue calculations are deterministic.
  const asOf = new Date('2026-05-07T12:00:00Z');

  console.log('\n=== Baseline (before any test mutations) ===');
  const dash0 = await buildDashboardData(KRAKEN_ID, asOf);
  console.log(`  totalInvoiced  = ${fmt(dash0.kpis.totalInvoiced)}`);
  console.log(`  totalPaid      = ${fmt(dash0.kpis.totalPaid)}`);
  console.log(`  outstandingAR  = ${fmt(dash0.kpis.outstandingAR)}`);

  // Self-consistency: sum(non-void invoice totals) - sum(applied payments)
  // == outstandingAR
  const invariantBalance =
    Math.round((dash0.kpis.totalInvoiced - dash0.kpis.totalPaid) * 100) / 100;
  check(
    'Outstanding AR matches totalInvoiced - totalPaid',
    invariantBalance,
    dash0.kpis.outstandingAR,
  );

  // Find an unpaid (sent) invoice we can mutate — pick the first non-paid,
  // non-void, non-draft one. Falls back to first sent.
  const allInvoices = listMockInvoices(KRAKEN_ID);
  const target = allInvoices.find(
    (i) => i.status === 'sent' && Number(i.amountPaid) === 0,
  );
  if (!target) {
    console.log('No sent/zero-paid invoice found in seed — aborting.');
    process.exit(1);
  }
  console.log(
    `\n=== Target invoice: ${target.number} (status=${target.status}, total=${fmt(Number(target.total))}) ===`,
  );

  // ----- Case 1: Unpaid invoice (baseline state for target) -----
  console.log('\nCase 1: unpaid invoice');
  const ag0 = await buildAgingRowsForCompany(KRAKEN_ID, asOf);
  const targetAging0 = ag0.find((r) => r.invoiceId === target.id);
  if (!targetAging0) {
    console.log('  FAIL  unpaid invoice should appear in aging');
    failed++;
  } else {
    check(
      'aging.balance equals invoice total',
      Number(target.total),
      targetAging0.balance,
    );
  }

  // ----- Case 2: Partial payment -----
  console.log('\nCase 2: partial payment');
  const total = Number(target.total);
  const partialAmount = +(total / 2).toFixed(2);
  createMockPayment(KRAKEN_ID, {
    invoiceId: target.id,
    paymentNumber: 'TEST-PARTIAL',
    paidDate: '2026-05-07',
    amount: partialAmount.toFixed(2),
    method: 'wire',
    reference: null,
    bankAccount: null,
    status: 'received',
    notes: null,
  });
  const dash2 = await buildDashboardData(KRAKEN_ID, asOf);
  const ag2 = await buildAgingRowsForCompany(KRAKEN_ID, asOf);
  const targetAging2 = ag2.find((r) => r.invoiceId === target.id);
  check(
    'dashboard outstandingAR drops by partialAmount',
    dash0.kpis.outstandingAR - partialAmount,
    dash2.kpis.outstandingAR,
  );
  check(
    'dashboard totalPaid grows by partialAmount',
    dash0.kpis.totalPaid + partialAmount,
    dash2.kpis.totalPaid,
  );
  if (!targetAging2) {
    console.log('  FAIL  partial-paid invoice should still be in aging');
    failed++;
  } else {
    check(
      'aging.balance == total - partialAmount',
      total - partialAmount,
      targetAging2.balance,
    );
    if (targetAging2.derivedStatus !== 'partial') {
      console.log(
        `  FAIL  derivedStatus should be 'partial', got '${targetAging2.derivedStatus}'`,
      );
      failed++;
    } else {
      passed++;
      console.log(`  PASS  derivedStatus = 'partial'`);
    }
  }

  // ----- Case 3: Mark Paid (auto-balancing payment) -----
  console.log('\nCase 3: Mark Paid via status transition (auto-balances)');
  await updateEntityStatus(KRAKEN_ID, 'invoice', target.id, 'paid');
  const dash3 = await buildDashboardData(KRAKEN_ID, asOf);
  const ag3 = await buildAgingRowsForCompany(KRAKEN_ID, asOf);
  check(
    'dashboard outstandingAR drops by remaining balance',
    dash2.kpis.outstandingAR - (total - partialAmount),
    dash3.kpis.outstandingAR,
  );
  check(
    'dashboard totalPaid increased by remaining balance',
    dash2.kpis.totalPaid + (total - partialAmount),
    dash3.kpis.totalPaid,
  );
  const targetAging3 = ag3.find((r) => r.invoiceId === target.id);
  if (targetAging3) {
    console.log(`  FAIL  paid invoice should NOT be in aging`);
    failed++;
  } else {
    passed++;
    console.log(`  PASS  paid invoice is no longer in aging`);
  }
  // Confirm `inv.amountPaid` cache was rebuilt to match total.
  const refreshedTarget = listMockInvoices(KRAKEN_ID).find(
    (i) => i.id === target.id,
  )!;
  check(
    'invoices.amount_paid cache equals total after Mark Paid',
    Number(refreshedTarget.total),
    Number(refreshedTarget.amountPaid),
  );
  if (refreshedTarget.status !== 'paid') {
    console.log(
      `  FAIL  invoice.status should be 'paid', got '${refreshedTarget.status}'`,
    );
    failed++;
  } else {
    passed++;
    console.log(`  PASS  invoice.status = 'paid'`);
  }

  // ----- Case 4: Multiple payments, fully paid via two halves -----
  console.log('\nCase 4: fresh invoice, two payments, fully paid');
  const target2 = allInvoices.find(
    (i) => i.id !== target.id && i.status === 'sent' && Number(i.amountPaid) === 0,
  );
  if (target2) {
    const total2 = Number(target2.total);
    const half = +(total2 / 2).toFixed(2);
    createMockPayment(KRAKEN_ID, {
      invoiceId: target2.id,
      paymentNumber: 'TEST-MULTI-1',
      paidDate: '2026-05-07',
      amount: half.toFixed(2),
      method: 'check',
      reference: null,
      bankAccount: null,
      status: 'received',
      notes: null,
    });
    createMockPayment(KRAKEN_ID, {
      invoiceId: target2.id,
      paymentNumber: 'TEST-MULTI-2',
      paidDate: '2026-05-07',
      amount: (total2 - half).toFixed(2),
      method: 'check',
      reference: null,
      bankAccount: null,
      status: 'applied',
      notes: null,
    });
    const refreshed2 = listMockInvoices(KRAKEN_ID).find(
      (i) => i.id === target2.id,
    )!;
    check(
      'two payments sum to invoice total',
      total2,
      Number(refreshed2.amountPaid),
    );
    if (refreshed2.status !== 'paid') {
      console.log(
        `  FAIL  status should auto-flip to 'paid' after two payments, got '${refreshed2.status}'`,
      );
      failed++;
    } else {
      passed++;
      console.log(`  PASS  status auto-flipped to 'paid' on full payment`);
    }
  } else {
    console.log('  SKIP  no second sent invoice in seed');
  }

  // ----- Case 5: Overdue invoice (derived status, not stored) -----
  console.log('\nCase 5: overdue invoice (derived from due date)');
  const overdueCandidate = listMockInvoices(KRAKEN_ID).find(
    (i) =>
      i.status === 'sent' &&
      i.dueDate &&
      new Date(`${i.dueDate}T00:00:00Z`).getTime() <
        new Date('2026-05-07T00:00:00Z').getTime() &&
      Number(i.amountPaid) === 0,
  );
  if (overdueCandidate) {
    const ag5 = await buildAgingRowsForCompany(KRAKEN_ID, asOf);
    const row = ag5.find((r) => r.invoiceId === overdueCandidate.id);
    if (!row) {
      console.log('  FAIL  overdue invoice should be in aging');
      failed++;
    } else if (row.derivedStatus !== 'overdue') {
      console.log(
        `  FAIL  derivedStatus should be 'overdue', got '${row.derivedStatus}'`,
      );
      failed++;
    } else if (row.daysOverdue <= 0) {
      console.log(
        `  FAIL  daysOverdue should be > 0, got ${row.daysOverdue}`,
      );
      failed++;
    } else {
      passed++;
      console.log(
        `  PASS  derivedStatus='overdue', daysOverdue=${row.daysOverdue}`,
      );
    }
  } else {
    console.log('  SKIP  no overdue candidate in seed');
  }

  // ----- Self-consistency: project summary vs dashboard -----
  console.log('\nProject-vs-dashboard self-consistency');
  const finalDash = await buildDashboardData(KRAKEN_ID, asOf);
  const allProjects = new Set(
    listMockInvoices(KRAKEN_ID)
      .filter((i) => i.status !== 'void')
      .map((i) => i.projectId),
  );
  let projOutstandingSum = 0;
  for (const pid of allProjects) {
    const summary = computeProjectInvoiceSummary(pid);
    projOutstandingSum += summary.outstandingBalance;
  }
  check(
    'sum of per-project outstanding equals dashboard outstandingAR',
    Math.round(projOutstandingSum * 100) / 100,
    finalDash.kpis.outstandingAR,
  );

  // Cache invariant: SUM(amount_paid) == dashboard totalPaid
  const cachedPaid = listMockInvoices(KRAKEN_ID)
    .filter((i) => i.status !== 'void')
    .reduce((acc, i) => acc + Number(i.amountPaid), 0);
  check(
    'invoices.amount_paid cache matches dashboard totalPaid',
    Math.round(cachedPaid * 100) / 100,
    finalDash.kpis.totalPaid,
  );

  // Force a cache-corruption scenario: hand-poke amount_paid to garbage and
  // confirm the dashboard formula still reports the truth.
  console.log('\nDefensive: corrupt amount_paid cache, dashboard still right');
  const corruptTarget = listMockInvoices(KRAKEN_ID).find(
    (i) => i.status !== 'void' && i.status !== 'draft',
  )!;
  const realAmountPaid = corruptTarget.amountPaid;
  corruptTarget.amountPaid = '999999.99'; // poison the cache
  const dashAfterCorruption = await buildDashboardData(KRAKEN_ID, asOf);
  check(
    'outstandingAR ignores poisoned cache',
    finalDash.kpis.outstandingAR,
    dashAfterCorruption.kpis.outstandingAR,
  );
  // Restore the cache so subsequent runs (HMR) aren't broken.
  corruptTarget.amountPaid = realAmountPaid;
  // Also call recompute to be certain.
  recomputeInvoicePaymentStateInMemory(corruptTarget.id);

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verification crashed:', err);
  process.exit(1);
});
