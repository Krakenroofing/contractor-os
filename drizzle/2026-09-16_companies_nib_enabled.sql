-- Per-company NIB switch: TRB (Bahamas) runs NIB; Kraken (US company) does
-- not — its employee forms drop the NIB fields and new employees are
-- forced NIB-exempt so payroll never withholds.
ALTER TABLE companies ADD COLUMN nib_enabled boolean NOT NULL DEFAULT true;
UPDATE companies SET nib_enabled = false WHERE id = '5269d154-c749-49f0-97a7-f5e02917e1dd';
