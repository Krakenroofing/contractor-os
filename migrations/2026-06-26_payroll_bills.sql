-- Payroll bills: one QB-style bill per employee per pay period. Records the
-- payroll accrual (gross / NIB / net) and is the payable the bank payment
-- settles. The double-entry GL is posted separately (source_type='payroll_bill').

CREATE TABLE IF NOT EXISTS payroll_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pay_period_id uuid NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bill_date date NOT NULL,
  gross numeric(14,2) NOT NULL DEFAULT 0,
  employee_nib numeric(14,2) NOT NULL DEFAULT 0,
  employer_nib numeric(14,2) NOT NULL DEFAULT 0,
  additions numeric(14,2) NOT NULL DEFAULT 0,
  deductions numeric(14,2) NOT NULL DEFAULT 0,
  net numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, pay_period_id)
);

CREATE INDEX IF NOT EXISTS payroll_bills_period_idx
  ON payroll_bills (company_id, pay_period_id);
