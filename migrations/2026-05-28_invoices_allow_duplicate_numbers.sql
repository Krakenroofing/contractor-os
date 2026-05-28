-- Allow repeated invoice numbers within a company.
--
-- TRB Ltd (and the business generally) re-uses invoice numbers across
-- years — e.g. 1002 in 2025 and again in 2026 are different real
-- invoices. The hard UNIQUE(company_id, number) forced the operator to
-- work around it by padding numbers with leading spaces during backfill,
-- which then broke QuickBooks reconciliation on the number key.
--
-- The invoice's true identity is its UUID `id`; `number` is a human
-- label and is allowed to repeat. We drop the unique constraint and keep
-- a plain (non-unique) index on (company_id, number) for lookups/sort.
--
-- Safe ordering: run this BEFORE deploying the code that removes the
-- app-level pre-check. While this is applied but the old code is still
-- live, duplicates remain blocked by the pre-check (harmless); we just
-- never want code that skips the pre-check to hit a still-present unique
-- index (that would 500).

DROP INDEX IF EXISTS invoices_company_number_uniq;

CREATE INDEX IF NOT EXISTS invoices_company_number_idx
  ON invoices (company_id, number);
