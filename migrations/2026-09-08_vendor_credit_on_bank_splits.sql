-- Vendor credits applicable to split-categorized bank transactions (not just
-- bills). A credit split line is a NEGATIVE line on the txn that posts
-- Cr Accounts Payable (clearing the Dr AP the credit created), tagged with
-- the credit it consumes; the application ledger stays in
-- vendor_credit_applications, which now targets EITHER a receipt (bill) OR an
-- imported transaction — exactly one.

alter table imported_transaction_lines
  add column if not exists vendor_credit_id uuid references vendor_credits(id) on delete restrict;

alter table vendor_credit_applications
  alter column receipt_id drop not null;

alter table vendor_credit_applications
  add column if not exists imported_transaction_id uuid
    references imported_transactions(id) on delete cascade;

alter table vendor_credit_applications
  add constraint vendor_credit_applications_one_target
  check (num_nonnulls(receipt_id, imported_transaction_id) = 1);

create index if not exists vendor_credit_applications_txn_idx
  on vendor_credit_applications(imported_transaction_id);
