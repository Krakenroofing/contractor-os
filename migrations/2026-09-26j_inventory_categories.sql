-- Olga's inventory categories request (task e6699461): ABC Supply's
-- structure as a MANAGED two-level list (Group > Category) instead of free
-- text, the two missing cost codes (roof tile, shingles), and each
-- category's default cost code from her Categories tab. Seeded for TRB.

CREATE TABLE IF NOT EXISTS inventory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  source text,
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_categories_company_name_uniq
  ON inventory_categories (company_id, lower(btrim(name)));

INSERT INTO cost_codes (library_id, code, description, category, division, sort_order, is_active)
SELECT 'ca2b4524-427c-4a0b-85e4-e2312238a702', v.code, v.description, 'material', 'Roofing', v.sort_order, true
  FROM (VALUES ('07-3100-Shingles', 'Shingles', 290), ('07-3200-RoofTile', 'Roof Tile', 300))
       AS v(code, description, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM cost_codes c
    WHERE c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702' AND lower(c.code) = lower(v.code));

INSERT INTO inventory_categories (company_id, group_name, name, source, sort_order)
VALUES
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Low Slope Roofing', 'Roof Membranes, Sheets, Roll Roofing & Underlayments', 'ABC', 10),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Low Slope Roofing', 'Single-Ply Accessories', 'Proposed', 20),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Low Slope Roofing', 'Roof Coatings & Primers', 'ABC', 30),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Steep Slope Roofing', 'Roof Shingles, Tiles & Panels', 'ABC', 40),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Insulation', 'Roof Insulation & Cover Boards', 'Proposed', 50),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Adhesives, Sealants & Accessories', 'ABC', 60),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Air, Vapor & Waterproofing Barriers & Accessories', 'ABC', 70),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Nails, Staples & Accessories', 'ABC', 80),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Screws, Fasteners & Plates', 'Proposed', 90),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Edge Flashing, Diverters & Channels', 'ABC', 100),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Roof to Wall Flashing', 'ABC', 110),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Roof Ventilation', 'ABC', 120),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Roof Drains, Pipe Boots & Penetration Flashings', 'Proposed', 130),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roofing Accessories', 'Sheet Metal, Coil & Flat Stock', 'Proposed', 140),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Rain Gutters, Guards & Downspouts', 'Gutters, Downspouts & Accessories', 'Proposed', 150),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Stucco', 'Concrete, Cement & Stucco', 'ABC', 160),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Windows & Doors', 'Windows, Doors & Skylights', 'ABC (top-level)', 170),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Lumber & Sheathing', 'Lumber & Sheathing', 'Proposed', 180),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Tools & Jobsite', 'Paint, Caulk, Adhesive & Heat Tools', 'ABC', 190),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Tools & Jobsite', 'Janitorial, Cleaning & Facility Maintenance', 'ABC', 200),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Tools & Jobsite', 'Material Handling', 'ABC', 210),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Tools & Jobsite', 'Safety & Jobsite Supplies', 'Proposed', 220),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Tools & Jobsite', 'Tools & Equipment (not stock)', 'Proposed', 230),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Special Order', 'Special Order / Non-Stock', 'Proposed', 240),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Review', 'Service / labor line – not inventory', 'Proposed', 250),
  ('81fe6373-8027-4ae6-a516-d0914ea7116f', 'Review', 'Review – not roofing or placeholder', 'Proposed', 260)
ON CONFLICT DO NOTHING;

-- Category default cost codes (TRB library first, then the standard one).
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roof Membranes, Sheets, Roll Roofing & Underlayments', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-5200-ModBit')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Single-Ply Accessories', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-5400-TPO-ACCESSORIES')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roof Coatings & Primers', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-5700-Coatings')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roof Shingles, Tiles & Panels', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-3200-RoofTile')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roof Insulation & Cover Boards', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-2200-TaperedISO')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Adhesives, Sealants & Accessories', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-9000-SEALANTS')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Air, Vapor & Waterproofing Barriers & Accessories', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-1000-Waterproofing')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Nails, Staples & Accessories', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-7100-FASTENERS')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Screws, Fasteners & Plates', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-7100-FASTENERS')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Edge Flashing, Diverters & Channels', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-6200-EDGE-METAL')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roof to Wall Flashing', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-6200-TERMINATION-BAR')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roof Ventilation', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-7200-RoofAccessories')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Roof Drains, Pipe Boots & Penetration Flashings', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-7200-DRAINS')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Sheet Metal, Coil & Flat Stock', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('05-5000-MiscMetals')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Gutters, Downspouts & Accessories', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-7100-Gutters')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Concrete, Cement & Stucco', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-3200-RoofTile')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Windows, Doors & Skylights', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('08-5113-ImpactWindows')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Lumber & Sheathing', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('06-1500-Sheathing')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Paint, Caulk, Adhesive & Heat Tools', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-5700-Coatings')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Janitorial, Cleaning & Facility Maintenance', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-7200-RoofAccessories')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Material Handling', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('LG-1000-Freight')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Safety & Jobsite Supplies', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('01-1400-SiteSafety')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
INSERT INTO inventory_category_cost_codes (company_id, category, cost_code_id)
SELECT '81fe6373-8027-4ae6-a516-d0914ea7116f', 'Special Order / Non-Stock', c.id FROM cost_codes c
 WHERE lower(c.code) = lower('07-7200-RoofAccessories')
   AND c.library_id IN ('ca2b4524-427c-4a0b-85e4-e2312238a702', '00000000-0000-0000-0000-000000000099')
 ORDER BY (c.library_id = 'ca2b4524-427c-4a0b-85e4-e2312238a702') DESC LIMIT 1
ON CONFLICT (company_id, category) DO UPDATE SET cost_code_id = EXCLUDED.cost_code_id, updated_at = now()
 WHERE inventory_category_cost_codes.cost_code_id IS NULL;
