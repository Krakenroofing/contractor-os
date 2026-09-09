-- Work-order materials can link to the inventory catalog: the office picks
-- the real product at review (crew submissions stay free text) so the
-- material list is normalized before it's priced on the invoice.
alter table work_order_materials
  add column if not exists inventory_item_id uuid
    references inventory_items(id) on delete set null;
