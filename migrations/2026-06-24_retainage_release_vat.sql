-- Retention VAT (Bahamas DIR rule): VAT on a retained amount becomes payable
-- when the retention becomes due or is received — i.e. at RELEASE, not on the
-- original progress invoice (which correctly taxes only the net-of-retention
-- amount). So a retainage release now carries its own VAT.
--
-- Additive + safe to run before deploy: existing releases default to 0 VAT
-- (there are none yet); Kraken (non-VAT) releases stay at 0.

ALTER TABLE public.retainage_releases
  ADD COLUMN IF NOT EXISTS vat_rate numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount numeric(14,2) NOT NULL DEFAULT 0;
