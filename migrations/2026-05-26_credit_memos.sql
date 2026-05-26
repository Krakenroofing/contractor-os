-- Credit memos: customer-facing credits issued against an invoice or a
-- project. Two-table model (parallel to invoices + invoice_payments):
--
--   credit_memos               — the credit obligation itself (CM-2026-001)
--   credit_memo_applications   — how the credit was spent (apply to an
--                                invoice, or cash refund out the door)
--
-- Why a separate entity instead of negative invoice_payments:
--   - Invoices stay intact at their original amount. History preserved.
--   - "Apply to future work" needs an open-balance concept that lives at
--     the customer level, not against a specific invoice.
--   - Refunds are cash events with their own bank-account + reference,
--     distinct from inbound payments.
--   - Net revenue reporting = invoice.subtotal − applied credit amount,
--     a clean GROUP BY rather than walking negative-payment rows.
--
-- Workflow:
--   1. Operator issues a credit memo against an invoice (or project).
--   2. Optionally applies it to that invoice (reduces net AR).
--   3. Or refunds it (cash out, recorded against a bank account).
--   4. Unapplied portion sits as an open balance on the customer until
--      consumed by a future invoice application or refund.

CREATE TYPE credit_memo_status AS ENUM (
  'draft',
  'issued',
  'partially_applied',
  'applied',
  'refunded',
  'void'
);

CREATE TYPE credit_memo_application_kind AS ENUM (
  -- Application against an invoice — reduces the invoice's net amount
  -- billed (does NOT touch invoice.amount_paid).
  'invoice_application',
  -- Cash refund — we cut a check / wire to the customer.
  'cash_refund'
);

CREATE TABLE IF NOT EXISTS credit_memos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  -- Project optional: a credit can be issued against a customer for
  -- standalone reasons (deposit refund, goodwill credit, etc.).
  project_id          uuid REFERENCES projects(id) ON DELETE SET NULL,
  -- Invoice optional: ditto. When set, this credit is the operator's
  -- intent to net against that specific invoice's billed value.
  invoice_id          uuid REFERENCES invoices(id) ON DELETE SET NULL,
  number              text NOT NULL,
  issue_date          date NOT NULL,
  -- Always positive in storage. Sign of "credit owed to customer" is
  -- implicit in the entity type.
  amount              numeric(14, 2) NOT NULL CHECK (amount > 0),
  -- Running total of how much of this credit has been consumed across
  -- applications (invoice apply + cash refund). Maintained by the
  -- application layer; status derives from the relationship between
  -- applied_amount and amount.
  applied_amount      numeric(14, 2) NOT NULL DEFAULT 0
                       CHECK (applied_amount >= 0 AND applied_amount <= amount),
  status              credit_memo_status NOT NULL DEFAULT 'draft',
  reason              text NOT NULL,
  notes               text,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_memos_company_number_uniq
  ON credit_memos (company_id, number);
CREATE INDEX IF NOT EXISTS credit_memos_customer_idx
  ON credit_memos (customer_id);
CREATE INDEX IF NOT EXISTS credit_memos_project_idx
  ON credit_memos (project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_memos_invoice_idx
  ON credit_memos (invoice_id)
  WHERE invoice_id IS NOT NULL;
-- Common filter: open / partially-applied credits per customer (for the
-- open-balance tile + AR aging net-out).
CREATE INDEX IF NOT EXISTS credit_memos_customer_open_idx
  ON credit_memos (company_id, customer_id)
  WHERE status IN ('issued', 'partially_applied');

CREATE TABLE IF NOT EXISTS credit_memo_applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  credit_memo_id      uuid NOT NULL REFERENCES credit_memos(id) ON DELETE CASCADE,
  applied_at          date NOT NULL,
  amount              numeric(14, 2) NOT NULL CHECK (amount > 0),
  kind                credit_memo_application_kind NOT NULL,
  -- For invoice_application kind: the target invoice. NULL for cash_refund.
  invoice_id          uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  -- For cash_refund kind: bank-account label + reference (check #, wire #).
  bank_account        text,
  reference           text,
  notes               text,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_memo_applications_credit_idx
  ON credit_memo_applications (credit_memo_id);
CREATE INDEX IF NOT EXISTS credit_memo_applications_invoice_idx
  ON credit_memo_applications (invoice_id)
  WHERE invoice_id IS NOT NULL;
