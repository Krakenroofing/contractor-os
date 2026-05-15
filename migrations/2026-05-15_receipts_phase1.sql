-- Receipts — Phase 1.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE deploying
-- the code that references these tables. Every statement is additive and uses
-- IF NOT EXISTS / duplicate-object guards so it can be re-run idempotently.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECTs at the bottom show the new tables and
--      enums.
--   4. Create the `receipt-files` Storage bucket (Private) in Supabase
--      Storage. Path layout: <companyId>/<year>/<month>/<uuid>.<ext>.
--   5. Then deploy the application code.
--
-- Scope summary:
--   - Two new tables: receipts, receipt_attachments
--   - Three new enums: receipt_status, payment_source_type,
--     receipt_attachment_kind
--   - NO changes to existing tables. Posting writes a NEW row into
--     job_cost_entries with source='receipt_import' (enum value landed in
--     Banking Phase 1) and source_ref_id pointing at the receipt id.

-- ===========================================================================
-- 1. Enums
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE receipt_status AS ENUM ('draft', 'posted', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_source_type AS ENUM ('bank', 'credit_card', 'cash', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE receipt_attachment_kind AS ENUM (
    'receipt_image',
    'supplier_invoice',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 2. receipts
-- ===========================================================================
-- Money: every amount is numeric(14, 2) — same precision as invoices and
-- job_cost_entries. `subtotal` is net of VAT, `vat_amount` is the VAT
-- component, `total` is gross. When VAT-included is true the operator may
-- enter only gross + rate and the form derives the rest.
--
-- Posting (Phase 2 receipts):
--   - status flips draft → posted on Post
--   - posted_job_cost_entry_id is the FK to the row Post wrote in
--     job_cost_entries; 1:1, never duplicated
--   - Unpost requires status='posted' and a still-existing entry
--
-- Multi-currency: `currency` records the receipt's native currency. The
-- posted job_cost_entry inherits that currency (Phase 2 receipts; FX
-- conversion is deferred).
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  accounting_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,

  payment_source_type payment_source_type NOT NULL DEFAULT 'cash',
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,

  receipt_date date NOT NULL,
  currency text NOT NULL DEFAULT 'USD',

  subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  vat_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL DEFAULT 0,
  vat_rate_percent numeric(6, 3),
  vat_included boolean NOT NULL DEFAULT true,
  vat_recoverable boolean NOT NULL DEFAULT true,
  vat_period_quarter text,
  vendor_tin text,

  -- Free-form cost_type override that the operator can pick on the receipt
  -- form. Mirrors the existing job_cost_type enum at the app layer (we keep
  -- it as text here to avoid an enum FK; the data-layer validates).
  cost_type text,

  status receipt_status NOT NULL DEFAULT 'draft',
  posted_at timestamptz,
  posted_job_cost_entry_id uuid REFERENCES public.job_cost_entries(id) ON DELETE SET NULL,

  is_billable boolean NOT NULL DEFAULT false,
  is_reimbursable boolean NOT NULL DEFAULT false,
  notes text,

  uploaded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS receipts_company_idx
  ON public.receipts(company_id);
CREATE INDEX IF NOT EXISTS receipts_project_idx
  ON public.receipts(project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS receipts_status_idx
  ON public.receipts(company_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS receipts_posted_jce_idx
  ON public.receipts(posted_job_cost_entry_id)
  WHERE posted_job_cost_entry_id IS NOT NULL;

-- ===========================================================================
-- 3. receipt_attachments
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.receipt_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,

  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,
  original_filename text NOT NULL,
  kind receipt_attachment_kind NOT NULL DEFAULT 'receipt_image',

  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS receipt_attachments_receipt_idx
  ON public.receipt_attachments(receipt_id);
CREATE INDEX IF NOT EXISTS receipt_attachments_company_idx
  ON public.receipt_attachments(company_id);

-- ===========================================================================
-- Verification
-- ===========================================================================

SELECT typname
FROM pg_type
WHERE typname IN ('receipt_status', 'payment_source_type', 'receipt_attachment_kind')
ORDER BY typname;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('receipts', 'receipt_attachments')
ORDER BY table_name;
