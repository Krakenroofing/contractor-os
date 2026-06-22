-- Add Time & Materials as an invoice billing type.
--
-- Service / T&M projects (see 2026-06-22_project_type_service_tm.sql) bill from
-- labor + materials rather than against a contract. Their invoices are marked
-- billingType = 't_m' so reporting, filters, and the PDF can distinguish T&M
-- billing from progress / lump-sum / change-order draws.
--
-- Additive enum value, so this is safe to run before the matching deploy:
-- existing invoices keep their current billing type. Run in Supabase first.
--
-- Note: ALTER TYPE ... ADD VALUE must run outside a transaction block — run
-- this statement on its own (the Supabase SQL editor does this by default).

ALTER TYPE invoice_billing_type ADD VALUE IF NOT EXISTS 't_m';
