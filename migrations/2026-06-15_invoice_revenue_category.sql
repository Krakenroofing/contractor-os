-- Accounting Phase 2.x: revenue by service type on the P&L.
--
-- The income side of the P&L was a single "Revenue" total (SUM of invoice
-- subtotals). To split it by service line (Roofing Revenue, Waterproofing
-- Revenue, Windows & Doors Revenue, ...), invoices get an optional revenue
-- category pointing at an income-rollup accounting_account.
--
-- Per-INVOICE (not per-line): the P&L income is driven by invoices.subtotal,
-- and lump-sum / progress-draw invoices don't carry detailed lines — so the
-- whole invoice's revenue is attributed to one income category. A contractor's
-- jobs are typically a single service type per project/invoice anyway.
--
-- Nullable: existing invoices stay uncategorized (shown as "Uncategorized
-- revenue" on the P&L) until an operator sets a category. No backfill — the
-- correct service type can't be inferred reliably from historical data.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS accounting_account_id uuid
  REFERENCES accounting_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_company_revenue_idx
  ON invoices (company_id, accounting_account_id);
