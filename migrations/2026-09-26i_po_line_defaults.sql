-- Olga's "PO and bill creation with less manual picking" request.
-- Accounting category (GL account) defaults travel like cost codes do:
-- PO line → product default → product category default → vendor default.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS default_accounting_account_id uuid
    REFERENCES accounting_accounts(id) ON DELETE SET NULL;

ALTER TABLE inventory_category_cost_codes
  ADD COLUMN IF NOT EXISTS accounting_account_id uuid
    REFERENCES accounting_accounts(id) ON DELETE SET NULL;
ALTER TABLE inventory_category_cost_codes
  ALTER COLUMN cost_code_id DROP NOT NULL;

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS accounting_account_id uuid
    REFERENCES accounting_accounts(id) ON DELETE SET NULL;
