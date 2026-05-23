-- Inventory Phase 6.0: product catalog.
--
-- This phase introduces a product/material master table that feeds
-- searchable dropdowns on POs, Invoices, and Estimates. It does NOT
-- yet track on-hand quantity, locations, receiving events, or
-- issuance to jobs — those land in later phases (6.1+).
--
-- The QuickBooks "Product/Service List" export drives the initial
-- seed via the UI importer at /inventory/import. The Quantity On
-- Hand column from that export is intentionally ignored — opening
-- balances will be established later via received POs, not by
-- inheriting QB drift.
--
-- The Expense Account column from QB is preserved verbatim in
-- qb_gl_account_text so a later phase can map it to a real
-- cost_code or accounting_account once the mapping is settled with
-- the operator.

CREATE TABLE IF NOT EXISTS inventory_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  -- QuickBooks namespaces items as "Category:Name" (e.g.
  -- "02 Site Work:Alum Pop Rivets White"). The importer splits on
  -- the first colon and stores the prefix here; manual entries can
  -- set it to anything.
  category              text,
  sku                   text,
  unit                  text,
  default_cost          numeric(14, 4) NOT NULL DEFAULT 0,
  default_cost_code_id  uuid REFERENCES cost_codes(id) ON DELETE SET NULL,
  is_taxable            boolean NOT NULL DEFAULT true,
  -- Raw QuickBooks expense-account text preserved for traceability.
  -- Examples: "50000 Cost of Goods Sold", "50400 Materials Costs".
  qb_gl_account_text    text,
  notes                 text,
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_items_company_idx
  ON inventory_items (company_id);

-- SKU is optional but should be unique within a company when set.
-- Partial unique index skips the nulls.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_company_sku_uniq
  ON inventory_items (company_id, sku)
  WHERE sku IS NOT NULL;

-- Name search uses trigram for the typeahead picker. Avoid hard
-- failure if pg_trgm isn't enabled — the picker still works with a
-- plain ILIKE prefix scan, just slower at scale.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS inventory_items_name_trgm_idx ON inventory_items USING gin (name gin_trgm_ops)';
  END IF;
END$$;

-- Wire the product master into the three line-item tables.
-- All three are nullable: free-text lines remain valid so existing
-- rows don't need backfilling and one-off purchases stay possible.
ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid
    REFERENCES inventory_items(id) ON DELETE SET NULL;

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid
    REFERENCES inventory_items(id) ON DELETE SET NULL;

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid
    REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchase_order_lines_item_idx
  ON purchase_order_lines (inventory_item_id);

CREATE INDEX IF NOT EXISTS invoice_line_items_item_idx
  ON invoice_line_items (inventory_item_id);

CREATE INDEX IF NOT EXISTS estimate_line_items_item_idx
  ON estimate_line_items (inventory_item_id);
