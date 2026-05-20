-- Projects — drop the project_number column.
--
-- IMPORTANT: Run against Supabase BEFORE deploying the application code.
-- The new code no longer references projects.number or the uniqueness
-- index. Skipping this migration won't break inserts (DROP COLUMN is
-- forwards-compatible with old code that still SELECTs *), but the index
-- becomes dead weight.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this file → Run.
--   3. Confirm the verification SELECTs report 0 indexes and 0 columns.
--   4. Then deploy.
--
-- Scope:
--   - Drop the (company_id, number) uniqueness index.
--   - Drop projects.number.

BEGIN;

DROP INDEX IF EXISTS projects_company_number_uniq;
ALTER TABLE projects DROP COLUMN IF EXISTS number;

COMMIT;

-- Verification — both queries should return 0 rows.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'projects_company_number_uniq';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'projects'
  AND column_name = 'number';
