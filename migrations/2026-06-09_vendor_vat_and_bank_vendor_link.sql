-- Vendor VAT reporting — Phase 1.
--
-- IMPORTANT: Run this against the production Supabase database BEFORE
-- deploying the code that references these columns. Every statement is
-- additive and idempotent.
--
-- Operator run path:
--   1. Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the verification SELECT returns 2 rows.
--   4. Deploy.
--
-- Purpose:
--   (1) vendors.vat_rate_percent — per-vendor VAT rate. NULL = not a
--       VAT-registered vendor (no input VAT). 10 = Bahamas standard rate.
--       The Vendor VAT report grosses spend down by this rate:
--         net = gross / (1 + rate/100);  vat = gross - net.
--   (2) imported_transactions.vendor_id — links a bank-statement expense to a
--       known vendor (the selectable payee). Nullable; ON DELETE SET NULL so
--       deleting a vendor never deletes bank history.
--
-- Both columns are nullable; existing rows are unaffected.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(6,3);

ALTER TABLE public.imported_transactions
  ADD COLUMN IF NOT EXISTS vendor_id uuid
    REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS imported_transactions_vendor_idx
  ON public.imported_transactions (vendor_id);

-- ===========================================================================
-- Verification — expect 2 rows: vendors.vat_rate_percent and
-- imported_transactions.vendor_id
-- ===========================================================================
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'vendors' AND column_name = 'vat_rate_percent')
    OR (table_name = 'imported_transactions' AND column_name = 'vendor_id')
  )
ORDER BY table_name, column_name;
