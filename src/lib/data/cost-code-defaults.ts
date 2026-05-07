// Canonical default cost-code library for Contractor OS.
//
// This file is the single source of truth for the global library. It is
// consumed by:
//   - the demo mock-store (so demo mode shows the same codes as production)
//   - the admin "Seed defaults" workflow (future)
//   - the production seed script
//
// The companion SQL migration `migrations/2026-05-07_phase1_cost_code_redesign.sql`
// inserts the same rows directly into Postgres for first-time provisioning.
// If you add or rename codes here, mirror the change in that migration so a
// fresh Supabase database produced by migration alone matches dev.

import type { costCodes } from '@/db/schema';

type Category = (typeof costCodes.$inferInsert)['category'];

export const GLOBAL_COST_CODE_LIBRARY_ID = '00000000-0000-0000-0000-000000000099';
export const GLOBAL_COST_CODE_LIBRARY_NAME = 'Standard Contractor Library';

export type CostCodeDivision = {
  code: string;
  name: string;
};

export const COST_CODE_DIVISIONS: CostCodeDivision[] = [
  { code: '01', name: 'General Conditions' },
  { code: '02', name: 'Demo' },
  { code: '03', name: 'Concrete' },
  { code: '05', name: 'Metals & Fabrication' },
  { code: '06', name: 'Carpentry' },
  { code: '07', name: 'Roofing & Waterproofing' },
  { code: '08', name: 'Openings & Glazing' },
  { code: '09', name: 'Finishes' },
  { code: '15', name: 'Mechanical' },
  { code: '16', name: 'Electrical' },
  { code: 'LG', name: 'Logistics & Freight' },
  { code: 'LB', name: 'Labor' },
  { code: 'EQ', name: 'Equipment' },
];

export const DIVISION_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  COST_CODE_DIVISIONS.map((d) => [d.code, d.name]),
);

export type DefaultCostCode = {
  code: string;
  division: string;
  description: string;
  category: Category;
  sortOrder: number;
  notes?: string;
};

// Sort order is allocated in 10s within each division so admins can splice
// custom codes between defaults without renumbering.
export const DEFAULT_COST_CODES: DefaultCostCode[] = [
  // 01 — General Conditions
  { division: '01', code: '01-1000-Supervision', description: 'Project Supervision', category: 'labor', sortOrder: 10 },
  { division: '01', code: '01-1100-PMFee', description: 'Project Management Fee', category: 'other', sortOrder: 20 },
  { division: '01', code: '01-1200-Permits', description: 'Permits & Fees', category: 'other', sortOrder: 30 },
  { division: '01', code: '01-1300-MobDemob', description: 'Mobilization / Demobilization', category: 'other', sortOrder: 40 },
  { division: '01', code: '01-1400-SiteSafety', description: 'Site Safety & PPE', category: 'other', sortOrder: 50 },
  { division: '01', code: '01-1500-Insurance', description: 'Project Insurance', category: 'other', sortOrder: 60 },
  { division: '01', code: '01-1600-Bonding', description: 'Performance & Payment Bonds', category: 'other', sortOrder: 70 },

  // 02 — Demo
  { division: '02', code: '02-4100-RoofTearOff', description: 'Roof Tear-Off', category: 'labor', sortOrder: 10 },
  { division: '02', code: '02-4200-SelectiveDemo', description: 'Selective Demolition', category: 'labor', sortOrder: 20 },
  { division: '02', code: '02-4300-Disposal', description: 'Disposal / Hauling', category: 'subcontract', sortOrder: 30 },
  { division: '02', code: '02-4400-Dumpster', description: 'Dumpster / Skip Hire', category: 'subcontract', sortOrder: 40 },

  // 03 — Concrete
  { division: '03', code: '03-3000-CIP', description: 'Cast-in-Place Concrete', category: 'subcontract', sortOrder: 10 },
  { division: '03', code: '03-3500-Toppings', description: 'Concrete Toppings', category: 'subcontract', sortOrder: 20 },
  { division: '03', code: '03-5400-NonShrinkGrout', description: 'Non-Shrink Grout', category: 'material', sortOrder: 30 },

  // 05 — Metals & Fabrication
  { division: '05', code: '05-1000-StructSteel', description: 'Structural Steel', category: 'subcontract', sortOrder: 10 },
  { division: '05', code: '05-5000-MiscMetals', description: 'Miscellaneous Metals', category: 'material', sortOrder: 20 },
  { division: '05', code: '05-5100-Railings', description: 'Railings & Handrails', category: 'material', sortOrder: 30 },
  { division: '05', code: '05-7000-CustomFab', description: 'Custom Fabrication — Labor', category: 'labor', sortOrder: 40 },
  { division: '05', code: '05-7100-RollFormShop', description: 'Roll-Form Shop Labor', category: 'labor', sortOrder: 50 },

  // 06 — Carpentry
  { division: '06', code: '06-1000-RoughCarpentry', description: 'Rough Carpentry — Labor', category: 'labor', sortOrder: 10 },
  { division: '06', code: '06-1500-Sheathing', description: 'Plywood / OSB Sheathing', category: 'material', sortOrder: 20 },
  { division: '06', code: '06-1600-Blocking', description: 'Wood Blocking & Nailers', category: 'material', sortOrder: 30 },
  { division: '06', code: '06-2000-FinishCarpentry', description: 'Finish Carpentry — Labor', category: 'labor', sortOrder: 40 },

  // 07 — Roofing & Waterproofing
  { division: '07', code: '07-1000-Waterproofing', description: 'Waterproofing System', category: 'material', sortOrder: 10 },
  { division: '07', code: '07-1000L-WaterproofingInstall', description: 'Waterproofing Install — Labor', category: 'labor', sortOrder: 15 },
  { division: '07', code: '07-2200-TaperedISO', description: 'Tapered ISO Insulation', category: 'material', sortOrder: 20 },
  { division: '07', code: '07-2210-CoverBoard', description: 'Cover Board', category: 'material', sortOrder: 25 },
  { division: '07', code: '07-2220-FluteFill', description: 'Flute Fill Insulation', category: 'material', sortOrder: 30 },
  { division: '07', code: '07-5200-ModBit', description: 'Modified Bitumen Membrane', category: 'material', sortOrder: 35 },
  { division: '07', code: '07-5200L-ModBitInstall', description: 'Mod Bit Install — Labor', category: 'labor', sortOrder: 36 },
  { division: '07', code: '07-5300-EPDM', description: 'EPDM Membrane', category: 'material', sortOrder: 40 },
  { division: '07', code: '07-5300L-EPDMInstall', description: 'EPDM Install — Labor', category: 'labor', sortOrder: 41 },
  { division: '07', code: '07-5400-TPO', description: 'TPO Membrane', category: 'material', sortOrder: 45 },
  { division: '07', code: '07-5400L-TPOInstall', description: 'TPO Install — Labor', category: 'labor', sortOrder: 46 },
  { division: '07', code: '07-5419-PVC', description: 'PVC Membrane', category: 'material', sortOrder: 50 },
  { division: '07', code: '07-5419L-PVCInstall', description: 'PVC Install — Labor', category: 'labor', sortOrder: 51 },
  { division: '07', code: '07-5600-LiquidApplied', description: 'Liquid-Applied Membrane', category: 'material', sortOrder: 55 },
  { division: '07', code: '07-5700-Coatings', description: 'Roof Coatings', category: 'material', sortOrder: 60 },
  { division: '07', code: '07-6100-StandingSeam', description: 'Standing Seam Metal Roofing', category: 'material', sortOrder: 65 },
  { division: '07', code: '07-6100L-StandingSeamInstall', description: 'Standing Seam Install — Labor', category: 'labor', sortOrder: 66 },
  { division: '07', code: '07-6110-AluminumRoof', description: 'Aluminum Roofing', category: 'material', sortOrder: 70 },
  { division: '07', code: '07-6120-CopperRoof', description: 'Copper Roofing', category: 'material', sortOrder: 75 },
  { division: '07', code: '07-7100-Gutters', description: 'Gutters & Downspouts', category: 'material', sortOrder: 80 },
  { division: '07', code: '07-7200-RoofAccessories', description: 'Roof Accessories', category: 'material', sortOrder: 85 },
  { division: '07', code: '07-8100-Skylights', description: 'Skylights', category: 'material', sortOrder: 90 },
  { division: '07', code: '07-8110-RoofHatches', description: 'Roof Hatches', category: 'material', sortOrder: 95 },
  { division: '07', code: '07-9500-ExpJoints', description: 'Expansion Joints', category: 'material', sortOrder: 100 },

  // 08 — Openings & Glazing
  { division: '08', code: '08-1410-PivotDoor', description: 'Pivot Doors', category: 'material', sortOrder: 10 },
  { division: '08', code: '08-1420-BifoldDoor', description: 'Bifold Doors', category: 'material', sortOrder: 20 },
  { division: '08', code: '08-1430-SlidingDoor', description: 'Sliding Doors', category: 'material', sortOrder: 30 },
  { division: '08', code: '08-3613-GarageDoor', description: 'Garage Doors', category: 'material', sortOrder: 40 },
  { division: '08', code: '08-5100-AluminumWindows', description: 'Aluminum Windows', category: 'material', sortOrder: 50 },
  { division: '08', code: '08-5113-ImpactWindows', description: 'Impact-Rated Windows', category: 'material', sortOrder: 60 },
  { division: '08', code: '08-5113L-ImpactWindowsInstall', description: 'Impact Windows Install — Labor', category: 'labor', sortOrder: 61 },
  { division: '08', code: '08-8000-Glazing', description: 'Glazing Systems', category: 'material', sortOrder: 70 },
  { division: '08', code: '08-8000L-GlazingInstall', description: 'Glazing Install — Labor', category: 'labor', sortOrder: 71 },
  { division: '08', code: '08-9100-Louvers', description: 'Louvers', category: 'material', sortOrder: 80 },

  // 09 — Finishes
  { division: '09', code: '09-2900-GypsumBoard', description: 'Gypsum Board', category: 'subcontract', sortOrder: 10 },
  { division: '09', code: '09-3000-Tile', description: 'Tile', category: 'subcontract', sortOrder: 20 },
  { division: '09', code: '09-6500-ResilientFlooring', description: 'Resilient Flooring', category: 'subcontract', sortOrder: 30 },
  { division: '09', code: '09-9100-Painting', description: 'Painting', category: 'subcontract', sortOrder: 40 },

  // 15 — Mechanical
  { division: '15', code: '15-0000-Mechanical', description: 'General Mechanical', category: 'subcontract', sortOrder: 10 },
  { division: '15', code: '15-3000-Plumbing', description: 'Plumbing', category: 'subcontract', sortOrder: 20 },
  { division: '15', code: '15-5000-HVAC', description: 'HVAC', category: 'subcontract', sortOrder: 30 },

  // 16 — Electrical
  { division: '16', code: '16-0000-Electrical', description: 'General Electrical', category: 'subcontract', sortOrder: 10 },
  { division: '16', code: '16-7000-LowVoltage', description: 'Low-Voltage Systems', category: 'subcontract', sortOrder: 20 },

  // LG — Logistics & Freight (Bahamas-aware)
  { division: 'LG', code: 'LG-1000-Freight', description: 'Inbound Freight', category: 'other', sortOrder: 10 },
  { division: 'LG', code: 'LG-1100-CustomsDuty', description: 'Bahamas Customs Duty', category: 'other', sortOrder: 20 },
  { division: 'LG', code: 'LG-1200-VAT', description: 'VAT (Bahamas)', category: 'other', sortOrder: 30 },
  { division: 'LG', code: 'LG-1300-Crating', description: 'Crating & Packaging', category: 'other', sortOrder: 40 },
  { division: 'LG', code: 'LG-1400-FlatRack', description: 'Flat-Rack Shipping', category: 'other', sortOrder: 50 },
  { division: 'LG', code: 'LG-1500-ContainerRental', description: 'Container Rental', category: 'other', sortOrder: 60 },
  { division: 'LG', code: 'LG-1600-IslandTransport', description: 'Island / Inter-Island Transportation', category: 'other', sortOrder: 70 },
  { division: 'LG', code: 'LG-1700-EquipmentFerry', description: 'Equipment Ferrying', category: 'other', sortOrder: 80 },

  // LB — Labor
  { division: 'LB', code: 'LB-1000-Foreman', description: 'Foreman Labor', category: 'labor', sortOrder: 10 },
  { division: 'LB', code: 'LB-2000-Skilled', description: 'Skilled Labor', category: 'labor', sortOrder: 20 },
  { division: 'LB', code: 'LB-3000-General', description: 'General Labor', category: 'labor', sortOrder: 30 },
  { division: 'LB', code: 'LB-4000-Overtime', description: 'Overtime Premium', category: 'labor', sortOrder: 40 },
  { division: 'LB', code: 'LB-5000-PerDiem', description: 'Per Diem', category: 'other', sortOrder: 50 },
  { division: 'LB', code: 'LB-6000-Housing', description: 'Crew Housing', category: 'other', sortOrder: 60 },
  { division: 'LB', code: 'LB-7000-Travel', description: 'Crew Travel', category: 'other', sortOrder: 70 },

  // EQ — Equipment
  { division: 'EQ', code: 'EQ-1000-Crane', description: 'Crane', category: 'equipment', sortOrder: 10 },
  { division: 'EQ', code: 'EQ-2000-Forklift', description: 'Forklift', category: 'equipment', sortOrder: 20 },
  { division: 'EQ', code: 'EQ-3000-LiftRental', description: 'Boom / Scissor Lift Rental', category: 'equipment', sortOrder: 30 },
  { division: 'EQ', code: 'EQ-4000-Welding', description: 'Welding Equipment', category: 'equipment', sortOrder: 40 },
  { division: 'EQ', code: 'EQ-5000-RollFormer', description: 'Roll-Forming Equipment', category: 'equipment', sortOrder: 50 },
  { division: 'EQ', code: 'EQ-6000-Safety', description: 'Safety Equipment', category: 'equipment', sortOrder: 60 },
];
