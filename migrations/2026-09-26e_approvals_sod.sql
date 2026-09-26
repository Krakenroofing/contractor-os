-- Roadmap P6 — approvals, separation of duties, parked-bill queue.
--
-- PO approval: a PO over the company's limit can't be issued (or have its
-- total raised after issue) until an approver other than its creator has
-- approved at least that amount. Enforced here (SQLSTATE KP003) so every
-- path — form, PDF import, status panel — obeys it.
-- Bills over the bill limit likewise need an approver other than whoever
-- entered the bill or created its vendor (enforced in the app at posting).
-- Owners may approve their own entries with a stated reason; each such
-- approval is logged in control_exceptions for the other owner to review.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS po_approval_limit numeric(14,2) DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS bill_approval_limit numeric(14,2) DEFAULT 5000;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_total numeric(14,2);

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Parked-bill queue: who is responsible for getting a draft bill posted.
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS parked_owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS control_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL,           -- 'po_self_approval' | 'bill_self_approval'
  entity_type text NOT NULL,    -- 'purchase_order' | 'bill'
  entity_id uuid NOT NULL,
  entity_label text,
  amount numeric(14,2),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS control_exceptions_company_idx
  ON control_exceptions (company_id, created_at DESC);

CREATE OR REPLACE FUNCTION kops_po_approval_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_limit numeric;
BEGIN
  SELECT po_approval_limit INTO v_limit FROM companies WHERE id = NEW.company_id;
  IF v_limit IS NULL OR NEW.status IN ('draft', 'void') OR NEW.total <= v_limit THEN
    RETURN NEW;
  END IF;
  IF NEW.approved_at IS NOT NULL AND COALESCE(NEW.approved_total, 0) >= NEW.total THEN
    RETURN NEW;
  END IF;
  -- Orders already out before this control: only a total increase re-triggers it.
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('draft', 'void') AND NEW.total <= OLD.total THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = 'KP003',
    MESSAGE = format(
      'Approval needed: PO %s is %s, over the %s approval limit. An approver other than its creator must approve it before it goes out.',
      NEW.number,
      to_char(NEW.total, 'FM$999,999,990.00'),
      to_char(v_limit, 'FM$999,999,990.00'));
END;
$$;

DROP TRIGGER IF EXISTS kops_po_approval_guard ON purchase_orders;
CREATE TRIGGER kops_po_approval_guard
  BEFORE INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION kops_po_approval_guard();
