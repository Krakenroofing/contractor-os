-- Inventory Phase 6.1: PO receiving.
--
-- Adds the per-line received-quantity column and the audit tables
-- that record each shipment as it arrives. The Drizzle schema for
-- these tables has shipped since Phase 6.0 but the prod DB never
-- had them — this migration brings the two in sync.
--
-- Receiving updates `purchase_order_lines.quantity_received` and
-- the PO header status (`issued` → `partially_received` → `received`)
-- but does NOT post to job_cost_entries. Job cost is recorded when
-- the vendor bill / receipt is posted; receiving is a physical-goods
-- event tracked separately to drive the "what's actually here?"
-- question and (later, in Phase 6.2) feed the inventory ledger.

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS quantity_received numeric(14, 4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS po_receipts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id     uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  received_at           timestamptz NOT NULL DEFAULT now(),
  received_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  notes                 text
);

CREATE INDEX IF NOT EXISTS po_receipts_po_idx
  ON po_receipts (purchase_order_id);

CREATE TABLE IF NOT EXISTS po_receipt_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id          uuid NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
  po_line_id          uuid NOT NULL REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
  quantity_received   numeric(14, 4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS po_receipt_lines_receipt_idx
  ON po_receipt_lines (receipt_id);

CREATE INDEX IF NOT EXISTS po_receipt_lines_po_line_idx
  ON po_receipt_lines (po_line_id);
