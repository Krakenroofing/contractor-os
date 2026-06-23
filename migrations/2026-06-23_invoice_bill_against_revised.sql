-- Invoice option: bill a progress % against the REVISED contract.
--
-- By default a base-track invoice's % draw bills against the ORIGINAL contract
-- value, and change orders are billed on their own track. This flag lets one
-- draw bill against the revised total (original + approved COs) with prior
-- billings combined across both tracks — so a single invoice can cover the
-- change order. Off = unchanged base/CO-track behavior.
--
-- Additive, defaulted false → safe to run before the matching deploy.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS bill_against_revised boolean NOT NULL DEFAULT false;
