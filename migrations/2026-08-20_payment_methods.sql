-- Payment methods (Chris, 2026-08-20): a per-company, user-managed list
-- ("add as I go") stamped onto expense details — bank/CC transactions and
-- receipts — and filterable on the new Expense report.

CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_methods_company_idx ON public.payment_methods(company_id);
-- One method per name per company (case-insensitive) so "add as you go"
-- can't create dupes.
CREATE UNIQUE INDEX payment_methods_company_name_key
  ON public.payment_methods(company_id, lower(name));

ALTER TABLE public.imported_transactions
  ADD COLUMN payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE public.receipts
  ADD COLUMN payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL;

-- Deny-all RLS (house pattern).
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
