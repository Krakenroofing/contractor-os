-- Related-party customers (e.g. Kraken billing TRB): invoices to them post
-- their subtotal to this balance-sheet account (e.g. "Due from TRB")
-- instead of a revenue account, and the P&L income section excludes them —
-- intercompany recharges are not revenue.
alter table customers
  add column if not exists intercompany_account_id uuid
    references accounting_accounts(id) on delete set null;
