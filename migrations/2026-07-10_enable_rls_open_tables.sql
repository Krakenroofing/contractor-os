-- Security: enable Row Level Security on 6 tables that were missing it.
--
-- The security advisor flagged these public-schema tables as RLS-DISABLED, so
-- the public anon key could read/write them through the PostgREST API. Two hold
-- financial data (journal_entries, journal_lines, payroll_bills).
--
-- The app itself is UNAFFECTED: it connects as the Supabase project owner via
-- the transaction pooler (see src/db/index.ts), and Postgres table owners
-- BYPASS RLS. RLS here is defense-in-depth against the browser / anon-key /
-- PostgREST path only. Enabling RLS with no policies = deny-all for
-- anon/authenticated, matching the house pattern already used by e.g.
-- credit_memos and receipts.
--
-- These 6 are recent tables (GL Phase 3, payroll bills, team tasks, timesheet
-- lunch overrides) whose original migrations missed the ENABLE that the
-- baseline tables got. Reversible via DISABLE ROW LEVEL SECURITY.

ALTER TABLE public.team_tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_task_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_lunch_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_bills             ENABLE ROW LEVEL SECURITY;
