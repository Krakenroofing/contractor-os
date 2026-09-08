-- Field work orders (service calls). A field employee submits the call —
-- who was on it, hours, materials used, who requested it, repairs done —
-- and the office reviews it on the dashboard, records the client, invoices,
-- and POSTS it: posting stamps a (service) project and writes the labor to
-- job_cost_entries (source 'work_order', source_ref_id = the work order id)
-- so job costing and the P&L Direct-Labor split pick it up like posted labor.

alter type job_cost_source add value if not exists 'work_order';

create type work_order_status as enum ('submitted', 'posted', 'void');

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  status work_order_status not null default 'submitted',
  work_date date not null,
  created_by_employee_id uuid not null references employees(id) on delete restrict,
  created_by_user_id uuid references users(id) on delete set null,
  requested_by text,
  repairs_done text,
  office_notes text,
  customer_id uuid references customers(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  posted_at timestamptz,
  posted_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index work_orders_company_idx on work_orders(company_id);
create index work_orders_status_idx on work_orders(company_id, status);
create unique index work_orders_company_number_uniq on work_orders(company_id, number);

-- Everyone on the call, with hours. `rate` is the COST rate used when the
-- office posts labor to job costing (prefilled from the employee's pay rate
-- for hourly workers, office-editable before posting).
create table work_order_labor (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  hours numeric(8,2) not null default 0,
  rate numeric(12,4) not null default 0,
  sort_order integer not null default 0
);
create index work_order_labor_wo_idx on work_order_labor(work_order_id);

-- Materials used on the call — name + quantity as the crew reports them.
-- Quantities are informational (for the office to price on the invoice);
-- material COST still flows through receipts categorized to the project.
create table work_order_materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  name text not null,
  quantity numeric(14,2) not null default 1,
  unit text,
  sort_order integer not null default 0
);
create index work_order_materials_wo_idx on work_order_materials(work_order_id);
