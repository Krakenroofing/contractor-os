-- Vendor credits (queued in the AP bills flow; forced by a live Pinders case
-- where the bank payment was bill − credit and nothing could reconcile).
--
-- A credit note from a vendor reduces what we owe them: at creation it posts
-- Dr Accounts Payable / Cr <expense category> (source 'vendor_credit').
-- Applications spread a credit across one or more bills (receipts); a bill's
-- remaining due = total − applied credits, which is what the bank payment
-- should equal — the reconciliation matcher uses that net figure.

CREATE TABLE public.vendor_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  credit_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  -- The expense category this credit reduces (required — drives the P&L
  -- contra line and the GL credit side).
  accounting_account_id uuid NOT NULL REFERENCES public.accounting_accounts(id) ON DELETE RESTRICT,
  reference text,
  notes text,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX vendor_credits_company_idx ON public.vendor_credits(company_id);
CREATE INDEX vendor_credits_vendor_idx ON public.vendor_credits(vendor_id);

CREATE TABLE public.vendor_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  credit_id uuid NOT NULL REFERENCES public.vendor_credits(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_credit_applications_credit_idx ON public.vendor_credit_applications(credit_id);
CREATE INDEX vendor_credit_applications_receipt_idx ON public.vendor_credit_applications(receipt_id);
CREATE INDEX vendor_credit_applications_company_idx ON public.vendor_credit_applications(company_id);

-- Deny-all RLS (house pattern).
ALTER TABLE public.vendor_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_applications ENABLE ROW LEVEL SECURITY;
