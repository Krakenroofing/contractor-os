-- System-assigned, gapless document numbers (roadmap Priority 1).
--
-- Invoices and credit memos get their number from a per-company counter
-- INSIDE the insert's own transaction (a BEFORE INSERT trigger updates the
-- counter row), so a failed insert rolls the counter back too — unlike a
-- Postgres SEQUENCE, no number is ever lost. The app inserts with an empty
-- number; an explicit number is only accepted as an "external" number
-- (historical re-entry of QuickBooks-era documents), which the app logs.
--
-- Counters skip any number an existing document already uses, so legacy
-- data can sit inside the range without collisions. Deleted drafts are
-- logged in document_number_log so every issued number is accounted for.

CREATE TABLE IF NOT EXISTS document_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- 'invoice' | 'credit_memo:<YYYY>'
  doc_type text NOT NULL,
  start_value bigint NOT NULL,
  next_value bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, doc_type)
);

CREATE TABLE IF NOT EXISTS document_number_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  number text NOT NULL,
  -- 'deleted_draft' | 'external'
  event text NOT NULL,
  document_id uuid,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  user_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_number_log_company_idx
  ON document_number_log (company_id, doc_type, created_at DESC);

-- ---------------------------------------------------------------------
-- Seed the counters from current data
-- ---------------------------------------------------------------------

-- Invoices: continue the series of the most recently CREATED numeric
-- invoice (same leading digit + same length, so '1045' continues 1xxx and
-- ignores '10655'), from the highest NON-VOID number in it. Voided typos
-- (Kraken's 1083) don't push the counter; the skip-taken rule steps over
-- them later.
INSERT INTO document_sequences (company_id, doc_type, start_value, next_value)
SELECT c.id, 'invoice', s.seed, s.seed
FROM companies c
CROSS JOIN LATERAL (
  SELECT COALESCE((
    SELECT MAX(i.number::bigint) + 1
    FROM invoices i
    WHERE i.company_id = c.id
      AND i.status <> 'void'
      AND i.number ~ '^[0-9]+$'
      AND left(i.number, 1) = left(r.number, 1)
      AND length(i.number) = length(r.number)
  ), 1001) AS seed
  FROM (
    SELECT number FROM invoices
    WHERE company_id = c.id AND number ~ '^[0-9]+$'
    ORDER BY created_at DESC LIMIT 1
  ) r
  UNION ALL
  SELECT 1001 WHERE NOT EXISTS (
    SELECT 1 FROM invoices WHERE company_id = c.id AND number ~ '^[0-9]+$'
  )
) s
ON CONFLICT (company_id, doc_type) DO NOTHING;

-- Credit memos: CM-YYYY-NNN, one counter per company per year.
INSERT INTO document_sequences (company_id, doc_type, start_value, next_value)
SELECT company_id,
       'credit_memo:' || substr(number, 4, 4),
       MAX(substr(number, 9)::bigint) + 1,
       MAX(substr(number, 9)::bigint) + 1
FROM credit_memos
WHERE number ~ '^CM-[0-9]{4}-[0-9]+$'
GROUP BY company_id, substr(number, 4, 4)
ON CONFLICT (company_id, doc_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- Assignment triggers
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_assign_invoice_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_next bigint;
BEGIN
  IF NEW.number IS NOT NULL AND btrim(NEW.number) <> '' THEN
    RETURN NEW; -- explicit (external / historical) number
  END IF;
  INSERT INTO document_sequences (company_id, doc_type, start_value, next_value)
  VALUES (NEW.company_id, 'invoice', 1001, 1001)
  ON CONFLICT (company_id, doc_type) DO NOTHING;
  SELECT next_value INTO v_next FROM document_sequences
  WHERE company_id = NEW.company_id AND doc_type = 'invoice'
  FOR UPDATE;
  WHILE EXISTS (
    SELECT 1 FROM invoices WHERE company_id = NEW.company_id AND number = v_next::text
  ) LOOP
    v_next := v_next + 1;
  END LOOP;
  NEW.number := v_next::text;
  UPDATE document_sequences
  SET next_value = v_next + 1, updated_at = now()
  WHERE company_id = NEW.company_id AND doc_type = 'invoice';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_assign_number ON invoices;
CREATE TRIGGER kops_assign_number BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION kops_assign_invoice_number();

CREATE OR REPLACE FUNCTION kops_assign_credit_memo_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_year text;
  v_type text;
  v_next bigint;
BEGIN
  IF NEW.number IS NOT NULL AND btrim(NEW.number) <> '' THEN
    RETURN NEW;
  END IF;
  v_year := to_char(COALESCE(NEW.issue_date, now()::date), 'YYYY');
  v_type := 'credit_memo:' || v_year;
  INSERT INTO document_sequences (company_id, doc_type, start_value, next_value)
  VALUES (NEW.company_id, v_type, 1, 1)
  ON CONFLICT (company_id, doc_type) DO NOTHING;
  SELECT next_value INTO v_next FROM document_sequences
  WHERE company_id = NEW.company_id AND doc_type = v_type
  FOR UPDATE;
  WHILE EXISTS (
    SELECT 1 FROM credit_memos
    WHERE company_id = NEW.company_id
      AND number = 'CM-' || v_year || '-' || lpad(v_next::text, 3, '0')
  ) LOOP
    v_next := v_next + 1;
  END LOOP;
  NEW.number := 'CM-' || v_year || '-' || lpad(v_next::text, 3, '0');
  UPDATE document_sequences
  SET next_value = v_next + 1, updated_at = now()
  WHERE company_id = NEW.company_id AND doc_type = v_type;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_assign_number ON credit_memos;
CREATE TRIGGER kops_assign_number BEFORE INSERT ON credit_memos
  FOR EACH ROW EXECUTE FUNCTION kops_assign_credit_memo_number();

-- Numbers are identity once assigned: no renumbering after insert.
CREATE OR REPLACE FUNCTION kops_freeze_document_number() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION USING
      ERRCODE = 'KP002',
      MESSAGE = format('Document numbers are system-assigned and can''t be changed (%s).', OLD.number);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kops_freeze_number ON invoices;
CREATE TRIGGER kops_freeze_number BEFORE UPDATE OF number ON invoices
  FOR EACH ROW EXECUTE FUNCTION kops_freeze_document_number();
DROP TRIGGER IF EXISTS kops_freeze_number ON credit_memos;
CREATE TRIGGER kops_freeze_number BEFORE UPDATE OF number ON credit_memos
  FOR EACH ROW EXECUTE FUNCTION kops_freeze_document_number();

-- ---------------------------------------------------------------------
-- Period guard: re-pointing a bank match at a different document also
-- changes how the (possibly closed-month) bank line posts.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION kops_guard_transaction_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
  v_company uuid;
  v_txn uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.reversed_at IS NOT DISTINCT FROM OLD.reversed_at
     AND NEW.imported_transaction_id IS NOT DISTINCT FROM OLD.imported_transaction_id
     AND NEW.matched_amount IS NOT DISTINCT FROM OLD.matched_amount
     AND NEW.match_type IS NOT DISTINCT FROM OLD.match_type
     AND NEW.receipt_id IS NOT DISTINCT FROM OLD.receipt_id
     AND NEW.invoice_payment_id IS NOT DISTINCT FROM OLD.invoice_payment_id
     AND NEW.payroll_bill_id IS NOT DISTINCT FROM OLD.payroll_bill_id
     AND NEW.credit_memo_id IS NOT DISTINCT FROM OLD.credit_memo_id THEN
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
