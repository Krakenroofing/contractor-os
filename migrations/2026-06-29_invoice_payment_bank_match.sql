-- Partial invoice-balance deposit matching.
--
-- Adds invoice_payments.imported_transaction_id so the bank "Match deposit to
-- invoices" picker can record a partial payment sized to a deposit and, on
-- Unmatch, remove exactly the payments it created (manually-recorded payments
-- have a NULL value here and are left untouched).
--
-- IMPORTANT: run in Supabase BEFORE deploying the code. Additive + idempotent.

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS imported_transaction_id uuid;

-- FK with ON DELETE SET NULL: deleting a bank import unlinks the payment but
-- never silently un-pays the invoice. Guarded so re-runs don't error.
DO $$ BEGIN
  ALTER TABLE public.invoice_payments
    ADD CONSTRAINT invoice_payments_imported_transaction_id_fkey
    FOREIGN KEY (imported_transaction_id)
    REFERENCES public.imported_transactions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS invoice_payments_imported_txn_idx
  ON public.invoice_payments(imported_transaction_id);

-- Verification
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoice_payments'
  AND column_name = 'imported_transaction_id';
