-- Fix: every company needs a row in `cost_code_libraries`, or the app's
-- cost-code dropdowns are empty and "Create cost code" throws
-- "No cost code library for company".
--
-- Root cause: prior to this migration, `cost_code_libraries` rows for real
-- (non-demo) companies were never created. The lookup function
-- `getCompanyLibraryId(companyId)` in src/lib/mock-store.ts only knew about
-- the two demo companies, so listCostCodes() short-circuited to [].
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the application code that uses the new async resolver. Every
-- statement is additive and idempotent.
--
-- Operator run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECTs at the bottom return one library per company plus
--      the global library.
--   4. Then deploy the application code.

-- ===========================================================================
-- Unique index: one non-global library per company
-- ===========================================================================
-- Partial index so the global library (company_id IS NULL) is excluded from
-- the uniqueness check.

CREATE UNIQUE INDEX IF NOT EXISTS cost_code_libraries_company_uniq
  ON public.cost_code_libraries(company_id)
  WHERE company_id IS NOT NULL;

-- ===========================================================================
-- Backfill: insert a library row for every existing company that doesn't
-- have one yet. Library name follows the convention "<Company> — Cost Codes".
-- ===========================================================================

-- companies has no soft-delete column, so no extra WHERE filter is needed.
INSERT INTO public.cost_code_libraries (company_id, name, is_global)
SELECT c.id, c.name || ' — Cost Codes', false
FROM public.companies c
LEFT JOIN public.cost_code_libraries lib
  ON lib.company_id = c.id
WHERE lib.id IS NULL;

-- ===========================================================================
-- Verification
-- ===========================================================================

-- Should return one row per non-deleted company, plus the global library.
SELECT
  lib.id,
  lib.name,
  lib.is_global,
  c.name AS company_name
FROM public.cost_code_libraries lib
LEFT JOIN public.companies c ON c.id = lib.company_id
ORDER BY lib.is_global DESC, c.name NULLS LAST;

-- Any companies still missing a library? (Should be empty after backfill.)
SELECT c.id, c.name
FROM public.companies c
LEFT JOIN public.cost_code_libraries lib ON lib.company_id = c.id
WHERE lib.id IS NULL;
