-- Phase 1: Cost-code system redesign — additive schema + global library seed.
--
-- Apply this against the production Supabase database BEFORE deploying the
-- code that references these columns. Every statement is additive and uses
-- IF NOT EXISTS / ON CONFLICT DO NOTHING so it can be re-run idempotently.
--
-- Run path:
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste this whole file. Run.
--   3. Confirm the SELECTs at the bottom return the expected counts.
--   4. Then deploy the application code.
--
-- Existing behaviour preserved:
--   - cost_codes.category (labor/material/subcontract/equipment/other) stays
--     authoritative — every existing reference (estimates, POs, COs, job-cost,
--     labor entries, assemblies) keeps working unchanged.
--   - Existing per-company libraries (Kraken, TRB) are untouched. Their codes
--     get is_active=TRUE by default. They can layer custom codes on top of
--     the global library going forward.

-- ===========================================================================
-- cost_codes: new columns (all nullable / safely defaulted)
-- ===========================================================================

ALTER TABLE public.cost_codes
  ADD COLUMN IF NOT EXISTS division TEXT,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.cost_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS cost_codes_library_division_sort_idx
  ON public.cost_codes (library_id, division, sort_order);

-- ===========================================================================
-- Global cost-code library
-- ===========================================================================

INSERT INTO public.cost_code_libraries (id, company_id, name, is_global)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  NULL,
  'Standard Contractor Library',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- Default cost codes — keyed on (library_id, code) so re-runs are no-ops.
-- ===========================================================================

INSERT INTO public.cost_codes (library_id, code, description, category, division, sort_order, is_active)
VALUES
  -- 01 General Conditions
  ('00000000-0000-0000-0000-000000000099', '01-1000-Supervision',         'Project Supervision',                 'labor',       '01',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '01-1100-PMFee',               'Project Management Fee',              'other',       '01',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '01-1200-Permits',             'Permits & Fees',                      'other',       '01',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', '01-1300-MobDemob',            'Mobilization / Demobilization',       'other',       '01',  40, TRUE),
  ('00000000-0000-0000-0000-000000000099', '01-1400-SiteSafety',          'Site Safety & PPE',                   'other',       '01',  50, TRUE),
  ('00000000-0000-0000-0000-000000000099', '01-1500-Insurance',           'Project Insurance',                   'other',       '01',  60, TRUE),
  ('00000000-0000-0000-0000-000000000099', '01-1600-Bonding',             'Performance & Payment Bonds',         'other',       '01',  70, TRUE),

  -- 02 Demo
  ('00000000-0000-0000-0000-000000000099', '02-4100-RoofTearOff',         'Roof Tear-Off',                       'labor',       '02',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '02-4200-SelectiveDemo',       'Selective Demolition',                'labor',       '02',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '02-4300-Disposal',            'Disposal / Hauling',                  'subcontract', '02',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', '02-4400-Dumpster',            'Dumpster / Skip Hire',                'subcontract', '02',  40, TRUE),

  -- 03 Concrete
  ('00000000-0000-0000-0000-000000000099', '03-3000-CIP',                 'Cast-in-Place Concrete',              'subcontract', '03',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '03-3500-Toppings',            'Concrete Toppings',                   'subcontract', '03',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '03-5400-NonShrinkGrout',      'Non-Shrink Grout',                    'material',    '03',  30, TRUE),

  -- 05 Metals & Fabrication
  ('00000000-0000-0000-0000-000000000099', '05-1000-StructSteel',         'Structural Steel',                    'subcontract', '05',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '05-5000-MiscMetals',          'Miscellaneous Metals',                'material',    '05',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '05-5100-Railings',            'Railings & Handrails',                'material',    '05',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', '05-7000-CustomFab',           'Custom Fabrication — Labor',          'labor',       '05',  40, TRUE),
  ('00000000-0000-0000-0000-000000000099', '05-7100-RollFormShop',        'Roll-Form Shop Labor',                'labor',       '05',  50, TRUE),

  -- 06 Carpentry
  ('00000000-0000-0000-0000-000000000099', '06-1000-RoughCarpentry',      'Rough Carpentry — Labor',             'labor',       '06',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '06-1500-Sheathing',           'Plywood / OSB Sheathing',             'material',    '06',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '06-1600-Blocking',            'Wood Blocking & Nailers',             'material',    '06',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', '06-2000-FinishCarpentry',     'Finish Carpentry — Labor',            'labor',       '06',  40, TRUE),

  -- 07 Roofing & Waterproofing
  ('00000000-0000-0000-0000-000000000099', '07-1000-Waterproofing',          'Waterproofing System',                  'material', '07',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-1000L-WaterproofingInstall',  'Waterproofing Install — Labor',         'labor',    '07',  15, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-2200-TaperedISO',             'Tapered ISO Insulation',                'material', '07',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-2210-CoverBoard',             'Cover Board',                           'material', '07',  25, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-2220-FluteFill',              'Flute Fill Insulation',                 'material', '07',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5200-ModBit',                 'Modified Bitumen Membrane',             'material', '07',  35, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5200L-ModBitInstall',         'Mod Bit Install — Labor',               'labor',    '07',  36, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5300-EPDM',                   'EPDM Membrane',                         'material', '07',  40, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5300L-EPDMInstall',           'EPDM Install — Labor',                  'labor',    '07',  41, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5400-TPO',                    'TPO Membrane',                          'material', '07',  45, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5400L-TPOInstall',            'TPO Install — Labor',                   'labor',    '07',  46, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5419-PVC',                    'PVC Membrane',                          'material', '07',  50, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5419L-PVCInstall',            'PVC Install — Labor',                   'labor',    '07',  51, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5600-LiquidApplied',          'Liquid-Applied Membrane',               'material', '07',  55, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-5700-Coatings',               'Roof Coatings',                         'material', '07',  60, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-6100-StandingSeam',           'Standing Seam Metal Roofing',           'material', '07',  65, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-6100L-StandingSeamInstall',   'Standing Seam Install — Labor',         'labor',    '07',  66, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-6110-AluminumRoof',           'Aluminum Roofing',                      'material', '07',  70, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-6120-CopperRoof',             'Copper Roofing',                        'material', '07',  75, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-7100-Gutters',                'Gutters & Downspouts',                  'material', '07',  80, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-7200-RoofAccessories',        'Roof Accessories',                      'material', '07',  85, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-8100-Skylights',              'Skylights',                             'material', '07',  90, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-8110-RoofHatches',            'Roof Hatches',                          'material', '07',  95, TRUE),
  ('00000000-0000-0000-0000-000000000099', '07-9500-ExpJoints',              'Expansion Joints',                      'material', '07', 100, TRUE),

  -- 08 Openings & Glazing
  ('00000000-0000-0000-0000-000000000099', '08-1410-PivotDoor',              'Pivot Doors',                           'material', '08',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-1420-BifoldDoor',             'Bifold Doors',                          'material', '08',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-1430-SlidingDoor',            'Sliding Doors',                         'material', '08',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-3613-GarageDoor',             'Garage Doors',                          'material', '08',  40, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-5100-AluminumWindows',        'Aluminum Windows',                      'material', '08',  50, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-5113-ImpactWindows',          'Impact-Rated Windows',                  'material', '08',  60, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-5113L-ImpactWindowsInstall',  'Impact Windows Install — Labor',        'labor',    '08',  61, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-8000-Glazing',                'Glazing Systems',                       'material', '08',  70, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-8000L-GlazingInstall',        'Glazing Install — Labor',               'labor',    '08',  71, TRUE),
  ('00000000-0000-0000-0000-000000000099', '08-9100-Louvers',                'Louvers',                               'material', '08',  80, TRUE),

  -- 09 Finishes
  ('00000000-0000-0000-0000-000000000099', '09-2900-GypsumBoard',         'Gypsum Board',                        'subcontract', '09',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '09-3000-Tile',                'Tile',                                'subcontract', '09',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '09-6500-ResilientFlooring',   'Resilient Flooring',                  'subcontract', '09',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', '09-9100-Painting',            'Painting',                            'subcontract', '09',  40, TRUE),

  -- 15 Mechanical
  ('00000000-0000-0000-0000-000000000099', '15-0000-Mechanical',          'General Mechanical',                  'subcontract', '15',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '15-3000-Plumbing',            'Plumbing',                            'subcontract', '15',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', '15-5000-HVAC',                'HVAC',                                'subcontract', '15',  30, TRUE),

  -- 16 Electrical
  ('00000000-0000-0000-0000-000000000099', '16-0000-Electrical',          'General Electrical',                  'subcontract', '16',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', '16-7000-LowVoltage',          'Low-Voltage Systems',                 'subcontract', '16',  20, TRUE),

  -- LG Logistics & Freight
  ('00000000-0000-0000-0000-000000000099', 'LG-1000-Freight',             'Inbound Freight',                     'other',       'LG',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LG-1100-CustomsDuty',         'Bahamas Customs Duty',                'other',       'LG',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LG-1200-VAT',                 'VAT (Bahamas)',                       'other',       'LG',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LG-1300-Crating',             'Crating & Packaging',                 'other',       'LG',  40, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LG-1400-FlatRack',            'Flat-Rack Shipping',                  'other',       'LG',  50, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LG-1500-ContainerRental',     'Container Rental',                    'other',       'LG',  60, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LG-1600-IslandTransport',     'Island / Inter-Island Transportation','other',       'LG',  70, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LG-1700-EquipmentFerry',      'Equipment Ferrying',                  'other',       'LG',  80, TRUE),

  -- LB Labor
  ('00000000-0000-0000-0000-000000000099', 'LB-1000-Foreman',             'Foreman Labor',                       'labor',       'LB',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LB-2000-Skilled',             'Skilled Labor',                       'labor',       'LB',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LB-3000-General',             'General Labor',                       'labor',       'LB',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LB-4000-Overtime',            'Overtime Premium',                    'labor',       'LB',  40, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LB-5000-PerDiem',             'Per Diem',                            'other',       'LB',  50, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LB-6000-Housing',             'Crew Housing',                        'other',       'LB',  60, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'LB-7000-Travel',              'Crew Travel',                         'other',       'LB',  70, TRUE),

  -- EQ Equipment
  ('00000000-0000-0000-0000-000000000099', 'EQ-1000-Crane',               'Crane',                               'equipment',   'EQ',  10, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'EQ-2000-Forklift',            'Forklift',                            'equipment',   'EQ',  20, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'EQ-3000-LiftRental',          'Boom / Scissor Lift Rental',          'equipment',   'EQ',  30, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'EQ-4000-Welding',             'Welding Equipment',                   'equipment',   'EQ',  40, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'EQ-5000-RollFormer',          'Roll-Forming Equipment',              'equipment',   'EQ',  50, TRUE),
  ('00000000-0000-0000-0000-000000000099', 'EQ-6000-Safety',              'Safety Equipment',                    'equipment',   'EQ',  60, TRUE)
ON CONFLICT (library_id, code) DO NOTHING;

-- ===========================================================================
-- Verification (re-run safe; expect non-zero counts)
-- ===========================================================================

SELECT 'Global library row' AS check, COUNT(*) AS n
  FROM public.cost_code_libraries
  WHERE id = '00000000-0000-0000-0000-000000000099';

SELECT 'Global default codes' AS check, COUNT(*) AS n
  FROM public.cost_codes
  WHERE library_id = '00000000-0000-0000-0000-000000000099';

SELECT 'New columns present' AS check,
       COUNT(*) FILTER (WHERE column_name = 'division')   AS division,
       COUNT(*) FILTER (WHERE column_name = 'parent_id')  AS parent_id,
       COUNT(*) FILTER (WHERE column_name = 'is_active')  AS is_active,
       COUNT(*) FILTER (WHERE column_name = 'sort_order') AS sort_order,
       COUNT(*) FILTER (WHERE column_name = 'notes')      AS notes
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'cost_codes';
