-- Accounting Phase 2: P&L plumbing.
--
-- Adds the operational-category link to job_cost_entries so cost reports
-- can `GROUP BY accounting_account_id` natively instead of pattern-matching
-- on cost_code or walking back through receipt_lines.
--
-- The column is nullable on purpose:
--   - Legacy entries (created before Phase 1 categories existed) backfill
--     from receipt_lines.posted_job_cost_entry_id where available, but
--     manual job_cost_entries that never came from a receipt stay NULL.
--   - Future labor entries / manual cost entries may not have a category
--     yet — UI prompts but doesn't enforce in Phase 2.
--
-- Receipts already carry accounting_account_id on both header and line
-- (see src/db/schema/receipts.ts) — this migration completes the chain:
-- receipt_line.accounting_account_id → job_cost_entries.accounting_account_id.

ALTER TABLE job_cost_entries
  ADD COLUMN IF NOT EXISTS accounting_account_id uuid
    REFERENCES accounting_accounts(id) ON DELETE SET NULL;

-- Backfill: every job_cost_entry that was posted from a receipt line
-- inherits its line's accounting_account_id. The Phase 6.1+ posted_job_cost_entry_id
-- pointer on receipt_lines is the 1:1 link.
UPDATE job_cost_entries jce
   SET accounting_account_id = rl.accounting_account_id
  FROM receipt_lines rl
 WHERE rl.posted_job_cost_entry_id = jce.id
   AND rl.accounting_account_id IS NOT NULL
   AND jce.accounting_account_id IS NULL;

-- Composite index for the P&L grouping query — sums cost by company +
-- account within a date range. Partial-filters out soft-deleted entries
-- to keep the index small and the report deterministic.
CREATE INDEX IF NOT EXISTS job_cost_entries_company_account_idx
  ON job_cost_entries (company_id, accounting_account_id)
  WHERE deleted_at IS NULL AND accounting_account_id IS NOT NULL;
