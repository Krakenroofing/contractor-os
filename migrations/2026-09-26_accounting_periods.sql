-- Posting periods (roadmap Priority 2, 2026-09-26).
--
-- Monthly periods per company (Kraken and TRB independent). A missing row
-- means OPEN — nothing changes until someone actually closes a month.
-- Once a month is CLOSED, nothing dated in it can be posted, changed,
-- deleted, or moved into / out of it. Corrections go into an open period.
-- Only the owner can reopen, and every close / reopen is logged.
--
-- Enforcement lives HERE, in triggers, so every write path is covered —
-- server actions, bulk imports, rules, and one-off scripts alike. The GL
-- itself stays derived (rebuilds re-post system entries from source
-- documents); freezing the SOURCE documents is what freezes the closed
-- GL. A per-period snapshot taken at close proves nothing drifted.

CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Per-account debit/credit totals for the month at the moment of close:
  -- { "<account_id>": [debit, credit], ... }. Compared against the live GL
  -- on the Periods page to prove the closed month never changed.
  gl_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_periods_first_of_month CHECK (EXTRACT(DAY FROM period_start) = 1),
  CONSTRAINT accounting_periods_company_start_uq UNIQUE (company_id, period_start)
);

CREATE TABLE IF NOT EXISTS accounting_period_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  action text NOT NULL CHECK (action IN ('closed', 'reopened')),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  user_name text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounting_period_log_company_idx
  ON accounting_period_log (company_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Core check
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_period_is_closed(p_company uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE company_id = p_company
      AND period_start = date_trunc('month', p_date)::date
      AND status = 'closed'
  )
$$;

-- Raises with a human-readable message (surfaced as-is by the app) and a
-- dedicated SQLSTATE so code can recognise it.
CREATE OR REPLACE FUNCTION kops_assert_period_open(p_company uuid, p_date date, p_what text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF kops_period_is_closed(p_company, p_date) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'KP001',
      MESSAGE = format(
        'Closed period: %s is dated %s, and %s is closed for posting. Post the correction in an open period, or ask the owner to reopen %s.',
        p_what,
        to_char(p_date, 'YYYY-MM-DD'),
        to_char(p_date, 'FMMonth YYYY'),
        to_char(p_date, 'FMMonth YYYY')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Bank transactions (+ splits, matches)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_imported_transactions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM kops_assert_period_open(NEW.company_id, NEW.transaction_date, 'This bank transaction');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.transaction_date, 'This bank transaction');
    RETURN OLD;
  END IF;
  -- Only GL-bearing fields are frozen; review flags, notes, payee, and
  -- reconciliation markers stay editable so closed statements can still
  -- be reconciled.
  IF NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.accounting_account_id IS DISTINCT FROM OLD.accounting_account_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
     OR NEW.is_ignored IS DISTINCT FROM OLD.is_ignored
     OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.transaction_date, 'This bank transaction');
    PERFORM kops_assert_period_open(NEW.company_id, NEW.transaction_date, 'This bank transaction');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON imported_transactions;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON imported_transactions
  FOR EACH ROW EXECUTE FUNCTION kops_guard_imported_transactions();

CREATE OR REPLACE FUNCTION kops_guard_imported_transaction_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
  v_company uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.accounting_account_id IS NOT DISTINCT FROM OLD.accounting_account_id
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
     AND NEW.cost_code_id IS NOT DISTINCT FROM OLD.cost_code_id
     AND NEW.imported_transaction_id IS NOT DISTINCT FROM OLD.imported_transaction_id THEN
    RETURN NEW;
  END IF;
  SELECT t.transaction_date, t.company_id INTO v_date, v_company
  FROM imported_transactions t
  WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.imported_transaction_id ELSE NEW.imported_transaction_id END;
  -- Parent gone (cascade delete in progress) → the parent's own guard ruled.
  IF v_date IS NOT NULL THEN
    PERFORM kops_assert_period_open(v_company, v_date, 'This bank transaction''s split');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON imported_transaction_lines;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON imported_transaction_lines
  FOR EACH ROW EXECUTE FUNCTION kops_guard_imported_transaction_lines();

CREATE OR REPLACE FUNCTION kops_guard_transaction_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
  v_company uuid;
  v_txn uuid;
BEGIN
  -- Matching / unmatching changes how the bank line posts (Undeposited
  -- Funds / AP vs its own category). Reversal is an UPDATE of reversed_at.
  IF TG_OP = 'UPDATE'
     AND NEW.reversed_at IS NOT DISTINCT FROM OLD.reversed_at
     AND NEW.imported_transaction_id IS NOT DISTINCT FROM OLD.imported_transaction_id
     AND NEW.matched_amount IS NOT DISTINCT FROM OLD.matched_amount
     AND NEW.match_type IS NOT DISTINCT FROM OLD.match_type THEN
    RETURN NEW;
  END IF;
  v_txn := CASE WHEN TG_OP = 'DELETE' THEN OLD.imported_transaction_id ELSE NEW.imported_transaction_id END;
  SELECT t.transaction_date, t.company_id INTO v_date, v_company
  FROM imported_transactions t WHERE t.id = v_txn;
  IF v_date IS NOT NULL THEN
    PERFORM kops_assert_period_open(v_company, v_date, 'This bank match');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON transaction_matches;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON transaction_matches
  FOR EACH ROW EXECUTE FUNCTION kops_guard_transaction_matches();

-- ---------------------------------------------------------------------
-- Bank / card opening balances (post a GL opening entry)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_bank_accounts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
       OR NEW.opening_date IS DISTINCT FROM OLD.opening_date
       OR NEW.accounting_account_id IS DISTINCT FROM OLD.accounting_account_id) THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.opening_date, 'This account''s opening balance');
    PERFORM kops_assert_period_open(NEW.company_id, NEW.opening_date, 'This account''s opening balance');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON bank_accounts;
CREATE TRIGGER kops_period_guard BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION kops_guard_bank_accounts();

-- ---------------------------------------------------------------------
-- Receipts / bills (only POSTED ones are on the books; drafts are parked)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_receipts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' AND OLD.deleted_at IS NULL THEN
      PERFORM kops_assert_period_open(OLD.company_id, OLD.receipt_date, 'This bill');
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'posted' THEN
      PERFORM kops_assert_period_open(NEW.company_id, NEW.receipt_date, 'This bill');
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.status = 'posted' OR NEW.status = 'posted') AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.vat_recoverable IS DISTINCT FROM OLD.vat_recoverable
       OR NEW.payment_source_type IS DISTINCT FROM OLD.payment_source_type
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    IF OLD.status = 'posted' THEN
      PERFORM kops_assert_period_open(OLD.company_id, OLD.receipt_date, 'This bill');
    END IF;
    IF NEW.status = 'posted' THEN
      PERFORM kops_assert_period_open(NEW.company_id, NEW.receipt_date, 'This bill');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON receipts;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION kops_guard_receipts();

CREATE OR REPLACE FUNCTION kops_guard_receipt_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
  v_company uuid;
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.subtotal IS NOT DISTINCT FROM OLD.subtotal
     AND NEW.vat_amount IS NOT DISTINCT FROM OLD.vat_amount
     AND NEW.total IS NOT DISTINCT FROM OLD.total
     AND NEW.accounting_account_id IS NOT DISTINCT FROM OLD.accounting_account_id
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
     AND NEW.cost_code_id IS NOT DISTINCT FROM OLD.cost_code_id
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NEW;
  END IF;
  SELECT r.receipt_date, r.company_id, r.status::text INTO v_date, v_company, v_status
  FROM receipts r
  WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.receipt_id ELSE NEW.receipt_id END;
  IF v_status = 'posted' THEN
    PERFORM kops_assert_period_open(v_company, v_date, 'This bill''s line');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON receipt_lines;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON receipt_lines
  FOR EACH ROW EXECUTE FUNCTION kops_guard_receipt_lines();

-- ---------------------------------------------------------------------
-- Invoices (draft / void are off the books) + lines + payments
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_invoices() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_live boolean;
  new_live boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('draft', 'void') THEN
      PERFORM kops_assert_period_open(OLD.company_id, OLD.invoice_date, 'This invoice');
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'void') THEN
      PERFORM kops_assert_period_open(NEW.company_id, NEW.invoice_date, 'This invoice');
    END IF;
    RETURN NEW;
  END IF;
  old_live := OLD.status NOT IN ('draft', 'void');
  new_live := NEW.status NOT IN ('draft', 'void');
  -- sent ↔ partial ↔ paid ↔ overdue come from payments recorded in open
  -- periods — allowed. Posting (draft→live) and voiding (live→void) are not.
  IF (old_live OR new_live) AND (
       old_live IS DISTINCT FROM new_live
       OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.retainage_amount IS DISTINCT FROM OLD.retainage_amount
       OR NEW.accounting_account_id IS DISTINCT FROM OLD.accounting_account_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    IF old_live THEN
      PERFORM kops_assert_period_open(OLD.company_id, OLD.invoice_date, 'This invoice');
    END IF;
    IF new_live THEN
      PERFORM kops_assert_period_open(NEW.company_id, NEW.invoice_date, 'This invoice');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON invoices;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION kops_guard_invoices();

CREATE OR REPLACE FUNCTION kops_guard_invoice_line_items() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
  v_company uuid;
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.line_total IS NOT DISTINCT FROM OLD.line_total
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit_cost IS NOT DISTINCT FROM OLD.unit_cost
     AND NEW.is_project_credit IS NOT DISTINCT FROM OLD.is_project_credit THEN
    RETURN NEW;
  END IF;
  SELECT i.invoice_date, i.company_id, i.status::text INTO v_date, v_company, v_status
  FROM invoices i
  WHERE i.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'void') THEN
    PERFORM kops_assert_period_open(v_company, v_date, 'This invoice''s line');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON invoice_line_items;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION kops_guard_invoice_line_items();

CREATE OR REPLACE FUNCTION kops_guard_invoice_payments() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_company uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.paid_date IS NOT DISTINCT FROM OLD.paid_date
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id THEN
    RETURN NEW;
  END IF;
  SELECT i.company_id INTO v_company FROM invoices i
  WHERE i.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF v_company IS NOT NULL THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM kops_assert_period_open(v_company, OLD.paid_date, 'This payment');
    END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN
      PERFORM kops_assert_period_open(v_company, NEW.paid_date, 'This payment');
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON invoice_payments;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION kops_guard_invoice_payments();

-- ---------------------------------------------------------------------
-- Customer credit memos (P&L contra revenue) + applications
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_credit_memos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      PERFORM kops_assert_period_open(OLD.company_id, OLD.issue_date, 'This credit memo');
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      PERFORM kops_assert_period_open(NEW.company_id, NEW.issue_date, 'This credit memo');
    END IF;
    RETURN NEW;
  END IF;
  -- applied_amount and issued ↔ partially_applied ↔ applied ↔ refunded
  -- move with applications made in open periods — allowed.
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
     OR NEW.change_order_id IS DISTINCT FROM OLD.change_order_id
     OR (NEW.status = 'void') IS DISTINCT FROM (OLD.status = 'void')
     OR (NEW.status = 'draft') IS DISTINCT FROM (OLD.status = 'draft') THEN
    IF OLD.status <> 'draft' THEN
      PERFORM kops_assert_period_open(OLD.company_id, OLD.issue_date, 'This credit memo');
    END IF;
    IF NEW.status <> 'draft' THEN
      PERFORM kops_assert_period_open(NEW.company_id, NEW.issue_date, 'This credit memo');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON credit_memos;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON credit_memos
  FOR EACH ROW EXECUTE FUNCTION kops_guard_credit_memos();

CREATE OR REPLACE FUNCTION kops_guard_credit_memo_applications() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.applied_at IS NOT DISTINCT FROM OLD.applied_at
     AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.applied_at, 'This credit application');
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    PERFORM kops_assert_period_open(NEW.company_id, NEW.applied_at, 'This credit application');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON credit_memo_applications;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON credit_memo_applications
  FOR EACH ROW EXECUTE FUNCTION kops_guard_credit_memo_applications();

-- ---------------------------------------------------------------------
-- Manual journal entries (system entries are derived + rebuilt — not
-- guarded here; their SOURCE documents are)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_journal_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_type = 'manual' THEN
      PERFORM kops_assert_period_open(OLD.company_id, OLD.entry_date, 'This journal entry');
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_type = 'manual' THEN
      PERFORM kops_assert_period_open(NEW.company_id, NEW.entry_date, 'This journal entry');
    END IF;
    RETURN NEW;
  END IF;
  -- Linking reversal ids is allowed; moving the date is not.
  IF (OLD.source_type = 'manual' OR NEW.source_type = 'manual')
     AND (NEW.entry_date IS DISTINCT FROM OLD.entry_date
          OR NEW.source_type IS DISTINCT FROM OLD.source_type) THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.entry_date, 'This journal entry');
    PERFORM kops_assert_period_open(NEW.company_id, NEW.entry_date, 'This journal entry');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON journal_entries;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION kops_guard_journal_entries();

CREATE OR REPLACE FUNCTION kops_guard_journal_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
  v_company uuid;
  v_source text;
BEGIN
  SELECT e.entry_date, e.company_id, e.source_type INTO v_date, v_company, v_source
  FROM journal_entries e
  WHERE e.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
  -- Parent missing = cascade from an entry delete its own guard allowed.
  IF v_source = 'manual' THEN
    PERFORM kops_assert_period_open(v_company, v_date, 'This journal entry');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON journal_lines;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION kops_guard_journal_lines();

-- ---------------------------------------------------------------------
-- Job costs, payroll bills, pay-period lock state
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_job_cost_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.entry_date, 'This job-cost entry');
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM kops_assert_period_open(NEW.company_id, NEW.entry_date, 'This job-cost entry');
    RETURN NEW;
  END IF;
  IF NEW.entry_date IS DISTINCT FROM OLD.entry_date
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
     OR NEW.accounting_account_id IS DISTINCT FROM OLD.accounting_account_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.entry_date, 'This job-cost entry');
    PERFORM kops_assert_period_open(NEW.company_id, NEW.entry_date, 'This job-cost entry');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON job_cost_entries;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON job_cost_entries
  FOR EACH ROW EXECUTE FUNCTION kops_guard_job_cost_entries();

CREATE OR REPLACE FUNCTION kops_guard_payroll_bills() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.bill_date, 'This payroll bill');
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM kops_assert_period_open(NEW.company_id, NEW.bill_date, 'This payroll bill');
    RETURN NEW;
  END IF;
  -- open ↔ paid follows bank matches in open periods — allowed.
  IF NEW.bill_date IS DISTINCT FROM OLD.bill_date
     OR NEW.gross IS DISTINCT FROM OLD.gross
     OR NEW.employee_nib IS DISTINCT FROM OLD.employee_nib
     OR NEW.employer_nib IS DISTINCT FROM OLD.employer_nib
     OR NEW.additions IS DISTINCT FROM OLD.additions
     OR NEW.deductions IS DISTINCT FROM OLD.deductions
     OR NEW.net IS DISTINCT FROM OLD.net
     OR (NEW.status = 'void') IS DISTINCT FROM (OLD.status = 'void') THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.bill_date, 'This payroll bill');
    PERFORM kops_assert_period_open(NEW.company_id, NEW.bill_date, 'This payroll bill');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON payroll_bills;
CREATE TRIGGER kops_period_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_bills
  FOR EACH ROW EXECUTE FUNCTION kops_guard_payroll_bills();

CREATE OR REPLACE FUNCTION kops_guard_pay_periods() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Locking / unlocking a payroll week changes how its pay reaches the
  -- P&L; the week belongs to the month it ENDS in.
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM kops_assert_period_open(OLD.company_id, OLD.end_date, 'This payroll week');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_period_guard ON pay_periods;
CREATE TRIGGER kops_period_guard BEFORE UPDATE ON pay_periods
  FOR EACH ROW EXECUTE FUNCTION kops_guard_pay_periods();
