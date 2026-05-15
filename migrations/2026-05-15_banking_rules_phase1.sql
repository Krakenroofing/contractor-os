-- Banking Rules — Phase 1 (classification assistance, no posting).
--
-- IMPORTANT: Run this against the production Supabase database BEFORE deploying
-- the code that references these tables. Every statement is additive and uses
-- IF NOT EXISTS / duplicate-object guards so it can be re-run idempotently.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECTs at the bottom show the new table and
--      the two new columns on imported_transactions.
--   4. Then deploy the application code.
--
-- Scope: suggestion-only classification rules.
--   * NO automatic posting into job_cost_entries.
--   * NO automatic creation of invoices or payments.
--   * Apply is a user-initiated action; the rule writes only category/project/
--     cost-code/notes onto an imported_transactions row.

-- ===========================================================================
-- 1. banking_rules table
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.banking_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Lower priority wins on ties. 100 is the default "normal" slot — more
  -- specific rules can be set lower (e.g. 10), broad rules higher (e.g. 200).
  priority integer NOT NULL DEFAULT 100,
  -- 'suggest' | 'auto_apply'. Phase 1 UI ignores 'auto_apply' — every rule
  -- behaves as 'suggest'. Column exists so Phase 3 can flip the switch
  -- without an enum migration.
  mode text NOT NULL DEFAULT 'suggest',
  -- 'all' | 'debits' | 'credits'. Filter on the signed amount: debits = amount<0,
  -- credits = amount>0.
  applies_to text NOT NULL DEFAULT 'all',
  -- NULL = rule applies to every bank account in the company.
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  -- Absolute-value range. Both optional. Compared against |amount|.
  amount_min numeric(14, 2),
  amount_max numeric(14, 2),
  -- JSONB array of { field, op, value, case_sensitive }. AND-ed together.
  -- field   ∈ description | payee | memo | reference
  -- op      ∈ contains | equals | starts_with | regex
  matchers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- JSONB object. Phase 1 reads accountingAccountId, projectId, costCodeId,
  -- notes. Future phases can add keys; the matcher tolerates extras.
  actions jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Denormalized hit count, incremented on each successful Apply.
  match_count integer NOT NULL DEFAULT 0,
  last_matched_at timestamptz,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS banking_rules_company_idx
  ON public.banking_rules(company_id);
-- Priority lookup excludes soft-deleted rules and disabled rules so the
-- matcher's primary query stays cheap as rule count grows.
CREATE INDEX IF NOT EXISTS banking_rules_company_priority_idx
  ON public.banking_rules(company_id, priority)
  WHERE deleted_at IS NULL AND enabled = true;

-- ===========================================================================
-- 2. imported_transactions: audit columns for rule application
-- ===========================================================================
-- applied_rule_id: which rule wrote the categorization onto this row. Stays
-- set after the user reviews so we can render "auto-filled by rule X" badges
-- and so future analytics can answer "which rules carry the workload?".
--
-- applied_rule_at: when. Lets us detect stale auto-fills (rule edited after
-- application) in Phase 2.
ALTER TABLE public.imported_transactions
  ADD COLUMN IF NOT EXISTS applied_rule_id uuid REFERENCES public.banking_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_rule_at timestamptz;

CREATE INDEX IF NOT EXISTS imported_transactions_applied_rule_idx
  ON public.imported_transactions(applied_rule_id)
  WHERE applied_rule_id IS NOT NULL;

-- ===========================================================================
-- Verification
-- ===========================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'banking_rules';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'imported_transactions'
  AND column_name IN ('applied_rule_id', 'applied_rule_at')
ORDER BY column_name;
