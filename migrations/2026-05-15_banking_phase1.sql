-- Banking & Receipts — Phase 1 (statement import, mapping, manual categorization).
--
-- IMPORTANT: Run this against the production Supabase database BEFORE deploying
-- the code that references these tables. Every statement is additive and uses
-- IF NOT EXISTS / duplicate-object guards so it can be re-run idempotently.
--
-- Operator run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECTs at the bottom show the new tables and enums.
--   4. Create the `statement-files` Storage bucket (Private). See
--      src/lib/storage/statement-files.ts for the path layout
--      (<companyId>/<year>/<month>/<uuid>.<ext>).
--   5. Then deploy the application code.
--
-- Scope: read-only side ledger. NO writes into job_cost_entries from this
-- phase. NO matching to invoice_payments. NO posting. Imported transactions
-- can be manually assigned to a project / cost code / accounting account.

-- ===========================================================================
-- 1. New enum values on existing types
-- ===========================================================================
-- Added now so Phase 2 (receipts) won't need an enum migration.
ALTER TYPE job_cost_source ADD VALUE IF NOT EXISTS 'receipt_import';

-- ===========================================================================
-- 2. New enums
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE accounting_method AS ENUM ('accrual', 'cash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE accounting_account_type AS ENUM (
    'bank',
    'credit_card',
    'income',
    'expense',
    'cogs_job_cost',
    'vat_payable',
    'vat_input',
    'owner_equity',
    'uncategorized_income',
    'uncategorized_expense'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bank_account_type AS ENUM ('bank', 'credit_card');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE statement_import_status AS ENUM (
    'pending',
    'mapped',
    'imported',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 3. companies: VAT flag, jurisdiction, accounting method
-- ===========================================================================
-- is_vat_active gates every VAT-aware UI block (Phase 2 receipts, future VAT
-- expense report). Phase 1 only seeds VAT accounts in the COA when this is
-- true. vat_rate_percent is kept untouched; we backfill is_vat_active from it.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_vat_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_jurisdiction text,
  ADD COLUMN IF NOT EXISTS accounting_method accounting_method NOT NULL DEFAULT 'accrual';

-- One-shot backfill: any company configured with a non-zero VAT rate before
-- this migration ran is implicitly VAT-active.
UPDATE public.companies
SET is_vat_active = true
WHERE vat_rate_percent IS NOT NULL
  AND vat_rate_percent::numeric > 0
  AND is_vat_active = false;

-- ===========================================================================
-- 4. accounting_accounts — lightweight Chart of Accounts
-- ===========================================================================
-- Not a full GL yet. Used in Phase 1 only as a category target for imported
-- transactions (and Phase 2 will use it for receipts). Code is optional —
-- auto-created bank accounts don't carry one.
CREATE TABLE IF NOT EXISTS public.accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  type accounting_account_type NOT NULL,
  parent_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  currency text NOT NULL DEFAULT 'USD',
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_accounts_company_code_uniq
  ON public.accounting_accounts(company_id, code)
  WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounting_accounts_company_idx
  ON public.accounting_accounts(company_id);
CREATE INDEX IF NOT EXISTS accounting_accounts_company_type_idx
  ON public.accounting_accounts(company_id, type);

-- ===========================================================================
-- 5. bank_accounts — registry of real bank/credit-card accounts
-- ===========================================================================
-- Distinct from the free-text bank_account string on invoice_payments. Each
-- bank_account pairs 1:1 with an accounting_accounts row (type bank|credit_card)
-- so future posting has a stable category target.
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  accounting_account_id uuid NOT NULL REFERENCES public.accounting_accounts(id) ON DELETE RESTRICT,
  name text NOT NULL,
  type bank_account_type NOT NULL,
  last4 text,
  currency text NOT NULL DEFAULT 'USD',
  opening_balance numeric(14, 2) NOT NULL DEFAULT 0,
  opening_date date,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_accounts_company_idx
  ON public.bank_accounts(company_id);

-- ===========================================================================
-- 6. bank_statement_mappings — saved column maps per (company, bank_account)
-- ===========================================================================
-- bank_account_id is NULL for "company-wide template" mappings. Otherwise the
-- mapping is preselected when importing for that specific account.
CREATE TABLE IF NOT EXISTS public.bank_statement_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  label text NOT NULL,
  -- {date:'Posted Date', desc:'Description', amount:'Amount',
  --  debit:'Withdrawal', credit:'Deposit', reference:'Check #',
  --  payee:'Payee', memo:'Memo'}
  column_map jsonb NOT NULL,
  -- 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'M/D/YYYY' | 'D/M/YYYY'
  date_format text NOT NULL DEFAULT 'YYYY-MM-DD',
  -- 'signed_amount' | 'debit_credit_split'
  amount_strategy text NOT NULL DEFAULT 'signed_amount',
  decimal_separator text NOT NULL DEFAULT '.',
  thousands_separator text NOT NULL DEFAULT ',',
  skip_rows integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_statement_mappings_account_idx
  ON public.bank_statement_mappings(bank_account_id);
CREATE INDEX IF NOT EXISTS bank_statement_mappings_company_idx
  ON public.bank_statement_mappings(company_id);

-- ===========================================================================
-- 7. statement_import_batches — one row per uploaded statement file
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.statement_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  mapping_id uuid REFERENCES public.bank_statement_mappings(id) ON DELETE SET NULL,
  status statement_import_status NOT NULL DEFAULT 'pending',
  source_filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  row_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  totals_debit numeric(14, 2) NOT NULL DEFAULT 0,
  totals_credit numeric(14, 2) NOT NULL DEFAULT 0,
  error_message text,
  uploaded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS statement_import_batches_account_idx
  ON public.statement_import_batches(bank_account_id);
CREATE INDEX IF NOT EXISTS statement_import_batches_company_idx
  ON public.statement_import_batches(company_id);

-- ===========================================================================
-- 8. imported_transactions — staging ledger (no posting in Phase 1)
-- ===========================================================================
-- Money: every amount is numeric(14, 2) — same precision as invoices, POs,
-- and job_cost_entries. `amount` is signed (positive = money in / credit;
-- negative = money out / debit) so all subsequent math is single-column.
-- `debit` and `credit` retain the raw split for audit/reporting and are
-- never relied on for arithmetic.
--
-- Duplicate detection: UNIQUE(company_id, bank_account_id, dedupe_hash). Hash
-- is sha256(bank_account_id|transaction_date|amount_cents|normalized_desc|
-- reference) computed in app code at insert time. A repeat import of the same
-- file is a no-op via ON CONFLICT DO NOTHING — duplicates are counted but
-- never inserted twice.
--
-- Manual assignment (Phase 1 deliberately ships these as nullable so the
-- transaction list can be triaged before matching/posting exists):
--   - accounting_account_id  → "category" target
--   - project_id             → which job this txn relates to
--   - cost_code_id           → cost code within that job
CREATE TABLE IF NOT EXISTS public.imported_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.statement_import_batches(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,

  transaction_date date NOT NULL,
  posted_date date,
  description text NOT NULL,
  payee text,
  memo text,

  debit numeric(14, 2),
  credit numeric(14, 2),
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  reference text,

  source_filename text NOT NULL,
  dedupe_hash text NOT NULL,

  is_reviewed boolean NOT NULL DEFAULT false,
  is_ignored boolean NOT NULL DEFAULT false,

  accounting_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL,

  notes text,
  raw_row jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS imported_transactions_dedupe_uniq
  ON public.imported_transactions(company_id, bank_account_id, dedupe_hash);
CREATE INDEX IF NOT EXISTS imported_transactions_batch_idx
  ON public.imported_transactions(batch_id);
CREATE INDEX IF NOT EXISTS imported_transactions_account_date_idx
  ON public.imported_transactions(bank_account_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS imported_transactions_project_idx
  ON public.imported_transactions(project_id)
  WHERE project_id IS NOT NULL;

-- ===========================================================================
-- Verification queries
-- ===========================================================================

SELECT typname
FROM pg_type
WHERE typname IN (
  'accounting_method',
  'accounting_account_type',
  'bank_account_type',
  'statement_import_status'
)
ORDER BY typname;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'accounting_accounts',
    'bank_accounts',
    'bank_statement_mappings',
    'statement_import_batches',
    'imported_transactions'
  )
ORDER BY table_name;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'companies'
  AND column_name IN ('is_vat_active', 'vat_jurisdiction', 'accounting_method')
ORDER BY column_name;

SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'job_cost_source'::regtype
  AND enumlabel = 'receipt_import';
