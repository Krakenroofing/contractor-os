-- Roadmap P3 — separate receiving from billing (GR/IR) + 3-way match.
--
-- From each company's cutover date, a PO's goods receipt recognizes the cost
-- (job cost + Dr expense / Cr GR/IR clearing) and the vendor bill clears
-- GR/IR against AP; only a price difference hits cost again at billing.
-- POs created before the cutover finish under the old rules (bill = cost).
-- A bill whose quantities/prices fall outside tolerance still posts, but is
-- blocked for payment until an approver releases it.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS grir_cutover_date date,
  ADD COLUMN IF NOT EXISTS match_qty_tolerance_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS match_price_tolerance_pct numeric(6,3) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS match_price_tolerance_amount numeric(14,2) NOT NULL DEFAULT 5;

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_match_tolerances_chk;
ALTER TABLE companies ADD CONSTRAINT companies_match_tolerances_chk CHECK (
  match_qty_tolerance_pct >= 0 AND match_qty_tolerance_pct <= 100
  AND match_price_tolerance_pct >= 0 AND match_price_tolerance_pct <= 100
  AND match_price_tolerance_amount >= 0
);

-- Frozen per PO at creation so changing the cutover later never re-rules
-- an order that is already in flight.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS grir boolean NOT NULL DEFAULT false;

-- Valuation snapshot: a goods receipt is valued at the PO price in force
-- when the goods arrived, even if the PO line's price is edited later.
ALTER TABLE po_receipt_lines
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4);
UPDATE po_receipt_lines rl
   SET unit_cost = pl.unit_cost
  FROM purchase_order_lines pl
 WHERE pl.id = rl.po_line_id AND rl.unit_cost IS NULL;

-- How much of a posted bill line cleared GR/IR (billed qty × PO price).
-- NULL = an ordinary line (cost recognized by the bill itself).
ALTER TABLE receipt_lines
  ADD COLUMN IF NOT EXISTS grir_cleared_amount numeric(14,2);

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS payment_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_block_reason text,
  ADD COLUMN IF NOT EXISTS payment_block_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_block_released_by_user_id uuid
    REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION kops_po_set_grir() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cutover date;
BEGIN
  SELECT grir_cutover_date INTO v_cutover FROM companies WHERE id = NEW.company_id;
  NEW.grir := v_cutover IS NOT NULL
    AND COALESCE(NEW.issue_date, (now() AT TIME ZONE 'America/Nassau')::date) >= v_cutover;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kops_po_set_grir ON purchase_orders;
CREATE TRIGGER kops_po_set_grir
  BEFORE INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION kops_po_set_grir();

-- Cutover: the first day of the next posting period for both companies.
UPDATE companies SET grir_cutover_date = DATE '2026-10-01'
 WHERE grir_cutover_date IS NULL;
