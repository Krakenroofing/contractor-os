-- Phase 3: double-entry general ledger.
--
-- journal_entries  = one balanced transaction (sum debits == sum credits).
-- journal_lines    = its postings to chart-of-accounts (accounting_accounts).
--
-- Every financial event becomes a balanced journal entry, so Trial Balance /
-- Balance Sheet tie out by construction. source_type/source_id link an
-- auto-posted entry to its event; reversals are mirror entries (never delete).

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  memo text,
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  reverses_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  reversed_by_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_entries_company_date_idx
  ON journal_entries (company_id, entry_date);
CREATE INDEX IF NOT EXISTS journal_entries_source_idx
  ON journal_entries (company_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS journal_lines_entry_idx
  ON journal_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_company_account_idx
  ON journal_lines (company_id, account_id);
