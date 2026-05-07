// One-shot reconciliation backfill runner.
//
// Usage:
//   node scripts/backfill-invoices-runner.cjs
//   (the .cjs runner stubs `server-only` so tsx can load the data layer)
//
// Reconciles every non-void invoice for every company in the seeded mock
// store. In production you should run the SQL migration directly:
//   migrations/2026-05-07_phase2_invoice_reconciliation_backfill.sql
//
// Idempotent — running twice produces zero new payment rows.

import { listMockCompanies } from '../src/lib/mock-store';
import { reconcileAllInvoices } from '../src/lib/data/invoice-reconcile';

async function main() {
  const companies = listMockCompanies();
  if (companies.length === 0) {
    console.log('No companies found in store.');
    process.exit(0);
  }
  for (const c of companies) {
    process.stdout.write(`Reconciling ${c.name} (${c.id})…\n`);
    const report = await reconcileAllInvoices(c.id);
    console.log(
      `  scanned=${report.invoicesScanned}  ` +
        `backfilled=${report.backfillPaymentsInserted}  ` +
        `updated=${report.invoicesUpdated}  ` +
        `already-consistent=${report.invoicesAlreadyConsistent}`,
    );
  }
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
