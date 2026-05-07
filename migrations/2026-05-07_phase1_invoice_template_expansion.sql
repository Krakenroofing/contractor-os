-- Phase 1: Invoice Template expansion.
--
-- Apply this against the production Supabase database BEFORE deploying the
-- code that references these columns. Every statement is additive and uses
-- IF NOT EXISTS / safe defaults so it can be re-run idempotently.
--
-- Run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECT at the bottom returns the new column list.
--   4. Then deploy the application code.

-- ===========================================================================
-- companies: tax / banking fields for the wire-instructions section
-- ===========================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tin_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_address TEXT,
  ADD COLUMN IF NOT EXISTS payment_notes TEXT;

-- ===========================================================================
-- invoice_templates: new section toggles, label overrides, VAT row config
-- ===========================================================================

ALTER TABLE public.invoice_templates
  -- Header customisation
  ADD COLUMN IF NOT EXISTS title_override TEXT,
  ADD COLUMN IF NOT EXISTS tin_label TEXT NOT NULL DEFAULT 'TIN',
  ADD COLUMN IF NOT EXISTS issued_by_label TEXT NOT NULL DEFAULT 'Issued by',

  -- Bill-to extras
  ADD COLUMN IF NOT EXISTS show_bill_to_tin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bill_to_attention_label TEXT NOT NULL DEFAULT 'Attention',

  -- Project / payment metadata block
  ADD COLUMN IF NOT EXISTS show_project_metadata BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS po_number_label TEXT NOT NULL DEFAULT 'Purchase Order',
  ADD COLUMN IF NOT EXISTS billing_number_label TEXT NOT NULL DEFAULT 'Billing #',
  ADD COLUMN IF NOT EXISTS project_description_label TEXT NOT NULL DEFAULT 'Project description',

  -- Wire instructions section. Bank details come from companies; this just
  -- toggles whether to display them on this template's invoices.
  ADD COLUMN IF NOT EXISTS show_wire_instructions BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wire_instructions_note TEXT,

  -- Qualifications / exclusions block
  ADD COLUMN IF NOT EXISTS show_qualifications BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qualifications_text TEXT,

  -- Account history (prior invoices for the same project)
  ADD COLUMN IF NOT EXISTS show_account_history BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS account_history_label TEXT NOT NULL DEFAULT 'Account history',

  -- Progress billing summary block
  ADD COLUMN IF NOT EXISTS show_progress_billing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS progress_billing_label TEXT NOT NULL DEFAULT 'Progress billing',
  ADD COLUMN IF NOT EXISTS contract_value_label TEXT NOT NULL DEFAULT 'Total contract value',
  ADD COLUMN IF NOT EXISTS change_orders_label TEXT NOT NULL DEFAULT 'Approved change orders',
  ADD COLUMN IF NOT EXISTS prior_billed_label TEXT NOT NULL DEFAULT 'Less previously billed',
  ADD COLUMN IF NOT EXISTS retainage_held_label TEXT NOT NULL DEFAULT 'Less retainage',

  -- VAT row in totals
  ADD COLUMN IF NOT EXISTS vat_label TEXT NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS vat_rate_percent NUMERIC(6, 3) NOT NULL DEFAULT 0;

-- ===========================================================================
-- invoices: optional billing label and per-invoice PO override
-- ===========================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billing_label TEXT,
  ADD COLUMN IF NOT EXISTS purchase_order_number TEXT;

-- ===========================================================================
-- Verification — should list every new column.
-- ===========================================================================

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'companies' AND column_name IN
      ('tin_number','bank_name','bank_branch','bank_account_name',
       'bank_account_number','bank_address','payment_notes'))
    OR
    (table_name = 'invoice_templates' AND column_name IN
      ('title_override','tin_label','issued_by_label','show_bill_to_tin',
       'bill_to_attention_label','show_project_metadata','po_number_label',
       'billing_number_label','project_description_label','show_wire_instructions',
       'wire_instructions_note','show_qualifications','qualifications_text',
       'show_account_history','account_history_label','show_progress_billing',
       'progress_billing_label','contract_value_label','change_orders_label',
       'prior_billed_label','retainage_held_label','vat_label','vat_rate_percent'))
    OR
    (table_name = 'invoices' AND column_name IN ('billing_label','purchase_order_number'))
  )
ORDER BY table_name, column_name;
