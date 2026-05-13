-- Invoicing upgrades:
--   1. New billing type `lump_sum` so invoices can be entered as a single
--      description + amount (no qty/unit-cost) for contract draws.
--   2. New `invoices.percent_of_contract` column for display-only "30% of
--      contract" tagging on draws.
--   3. New `customers.tin_number` column so client TIN can render on the
--      invoice bill-to block.
--
-- IMPORTANT: run BEFORE deploying the application code. Idempotent + additive.

-- ===========================================================================
-- 1. New enum value
-- ===========================================================================
-- ADD VALUE IF NOT EXISTS is supported in Postgres 9.6+.

ALTER TYPE invoice_billing_type ADD VALUE IF NOT EXISTS 'lump_sum';

-- ===========================================================================
-- 2. New invoices column
-- ===========================================================================
-- numeric(6,3) matches existing percent columns (e.g. retainage_percent).
-- Nullable — only relevant for lump_sum / progress draws.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS percent_of_contract numeric(6, 3);

-- ===========================================================================
-- 3. New customers column
-- ===========================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tin_number text;

-- ===========================================================================
-- Verification
-- ===========================================================================

SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'invoice_billing_type'::regtype
ORDER BY enumsortorder;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'invoices' AND column_name = 'percent_of_contract')
       OR (table_name = 'customers' AND column_name = 'tin_number'))
ORDER BY table_name, column_name;
