-- Photos on work orders: the crew attaches job photos when submitting a
-- service call. Blobs live in the existing private `daily-report-photos`
-- bucket under <companyId>/work-orders/<workOrderId>/<uuid>.<ext>. Once the
-- admin posts the WO (project stamped), the project's Photos gallery lists
-- these alongside daily-report photos; `include_on_invoice` marks the ones
-- that render on the client's invoice PDF (photo gallery section).
create table work_order_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  storage_path text not null,
  file_name text,
  mime_type text,
  byte_size integer,
  caption text,
  include_on_invoice boolean not null default false,
  uploaded_by uuid references users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  sort_order integer not null default 0
);
create index work_order_photos_wo_idx on work_order_photos(work_order_id);
create index work_order_photos_company_idx on work_order_photos(company_id);
