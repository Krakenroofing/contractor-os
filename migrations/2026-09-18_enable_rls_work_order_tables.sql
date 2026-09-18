-- Security: enable Row Level Security on the 4 work-order tables.
--
-- The security advisor flagged these public-schema tables as RLS-DISABLED, so
-- the public anon key could read/write them through the PostgREST API.
--
-- The app itself is UNAFFECTED: it connects as the Supabase project owner via
-- the transaction pooler (see src/db/index.ts), and Postgres table owners
-- BYPASS RLS. RLS here is defense-in-depth against the browser / anon-key /
-- PostgREST path only. Enabling RLS with no policies = deny-all for
-- anon/authenticated, matching the house pattern already used by e.g.
-- credit_memos and receipts, and applied to the same class of finding in
-- 2026-07-10_enable_rls_open_tables.sql.
--
-- These 4 are recent tables (field work orders / service calls) whose
-- original migrations missed the ENABLE that the baseline tables got.
-- Reversible via DISABLE ROW LEVEL SECURITY.

ALTER TABLE public.work_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_labor     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_photos    ENABLE ROW LEVEL SECURITY;
