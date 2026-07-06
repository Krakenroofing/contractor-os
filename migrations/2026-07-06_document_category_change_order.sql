-- ===========================================================================
-- Document category: add 'change_order'
-- ===========================================================================
-- Lets project documents be filed as Change Order files (CO proposals, signed
-- change orders, backup) instead of falling into the generic 'proposal'/'other'
-- buckets. The uploader dropdown and the per-section "Upload" links on the
-- project page depend on this value existing.
--
-- Ordering:
-- 1. Run THIS migration in Supabase first.
-- 2. THEN deploy the application code.
-- (Deploying code that writes 'change_order' before the enum knows the value
--  would 500 on insert.)
--
-- Note: ALTER TYPE ... ADD VALUE is autocommit and cannot run inside a
-- transaction block — run it on its own (the Supabase SQL editor does this by
-- default). IF NOT EXISTS makes the migration safe to re-run.

ALTER TYPE document_category ADD VALUE IF NOT EXISTS 'change_order';
