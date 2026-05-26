// Roofing-industry cost-code seed — DATA ONLY.
//
// This file is intentionally NOT 'server-only' so the install card on
// /cost-codes (a client component) can import ROOFING_COST_CODE_SEED to
// render the preview list. The actual install function (server-only,
// uses createCostCode) lives in roofing-cost-codes.install.ts so the
// server-only import stays out of the client bundle.

import type { CreateCostCodeInput } from '@/lib/data/cost-codes';

type Seed = CreateCostCodeInput & { code: string };

/**
 * Curated roofing cost-code list. Sort order increments by 10 so a future
 * insertion lands cleanly between two existing rows. Codes follow CSI-ish
 * conventions (07 = Thermal & Moisture Protection) but the leaf labels
 * cover both the major systems and the accessories Chris flagged as
 * missing (insulation, cover board, adhesives, terminations, fasteners,
 * walk pads, drains, sealants).
 *
 * Default cost is intentionally left null on most codes — Chris fills
 * those in over time. The PO line "Update defaults" dialog is the
 * fastest way to set them.
 */
export const ROOFING_COST_CODE_SEED: Seed[] = [
  // --- TPO membrane system ---
  {
    code: '07-5400-TPO-MEMBRANE',
    description: 'TPO Membrane (60 mil)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 100,
  },
  {
    code: '07-5400-TPO-ACCESSORIES',
    description: 'TPO Accessories (boots, corners, splice plates)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 110,
  },
  {
    code: '07-5400-TPO-WALK-PADS',
    description: 'TPO Walk Pads',
    category: 'material',
    division: 'Roofing',
    sortOrder: 120,
  },

  // --- Modified bitumen system ---
  {
    code: '07-5200-MOD-BIT-MEMBRANE',
    description: 'Modified Bitumen Membrane',
    category: 'material',
    division: 'Roofing',
    sortOrder: 200,
  },
  {
    code: '07-5200-MOD-BIT-CAP',
    description: 'Modified Bitumen Cap Sheet',
    category: 'material',
    division: 'Roofing',
    sortOrder: 210,
  },

  // --- EPDM system ---
  {
    code: '07-5300-EPDM-MEMBRANE',
    description: 'EPDM Membrane (45 mil / 60 mil)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 300,
  },
  {
    code: '07-5300-EPDM-ACCESSORIES',
    description: 'EPDM Accessories (cover tape, primer, splice tape)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 310,
  },

  // --- Insulation + cover board ---
  {
    code: '07-2200-POLYISO-FLAT',
    description: 'Polyiso Flat Insulation',
    category: 'material',
    division: 'Roofing',
    sortOrder: 400,
  },
  {
    code: '07-2200-TAPERED-INSULATION',
    description: 'Tapered Insulation Package',
    category: 'material',
    division: 'Roofing',
    sortOrder: 410,
  },
  {
    code: '07-2200-COVER-BOARD',
    description: 'Cover Board (Densdeck / Securock)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 420,
  },
  {
    code: '07-2700-VAPOR-BARRIER',
    description: 'Vapor Barrier / Underlayment',
    category: 'material',
    division: 'Roofing',
    sortOrder: 430,
  },

  // --- Attachment / fasteners ---
  {
    code: '07-7100-FASTENERS',
    description: 'Roofing Fasteners + Plates',
    category: 'material',
    division: 'Roofing',
    sortOrder: 500,
  },
  {
    code: '07-7100-ADHESIVE-BONDING',
    description: 'Bonding Adhesive (membrane to substrate)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 510,
  },
  {
    code: '07-7100-ADHESIVE-INSUL',
    description: 'Insulation Adhesive (low-rise foam)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 520,
  },

  // --- Sealants / terminations / flashings ---
  {
    code: '07-9000-SEALANTS',
    description: 'Sealants / Caulkings (lap sealant, water cut-off mastic)',
    category: 'material',
    division: 'Roofing',
    sortOrder: 600,
  },
  {
    code: '07-6200-EDGE-METAL',
    description: 'Edge Metal / Drip Edge / Coping',
    category: 'material',
    division: 'Roofing',
    sortOrder: 610,
  },
  {
    code: '07-6200-TERMINATION-BAR',
    description: 'Termination Bar / Counterflashing',
    category: 'material',
    division: 'Roofing',
    sortOrder: 620,
  },
  {
    code: '07-6200-PITCH-POCKETS',
    description: 'Pitch Pockets / Penetration Flashings',
    category: 'material',
    division: 'Roofing',
    sortOrder: 630,
  },

  // --- Drainage ---
  {
    code: '07-7200-DRAINS',
    description: 'Roof Drains + Strainers',
    category: 'material',
    division: 'Roofing',
    sortOrder: 700,
  },
  {
    code: '07-7200-SCUPPERS',
    description: 'Scuppers / Overflow Outlets',
    category: 'material',
    division: 'Roofing',
    sortOrder: 710,
  },

  // --- Labor ---
  {
    code: '07-0000-LABOR-TEAROFF',
    description: 'Roofing Tear-Off Labor',
    category: 'labor',
    division: 'Roofing',
    sortOrder: 800,
  },
  {
    code: '07-0000-LABOR-INSTALL',
    description: 'Roofing Install Labor',
    category: 'labor',
    division: 'Roofing',
    sortOrder: 810,
  },
  {
    code: '07-0000-LABOR-DETAIL',
    description: 'Roofing Detail Labor (flashings / terminations)',
    category: 'labor',
    division: 'Roofing',
    sortOrder: 820,
  },

  // --- Equipment ---
  {
    code: '07-0000-CRANE-DAY',
    description: 'Crane Day Rate (loading roof materials)',
    category: 'equipment',
    division: 'Roofing',
    sortOrder: 900,
  },
  {
    code: '07-0000-BOOMLIFT-DAY',
    description: 'Boom Lift / Manlift Day Rate',
    category: 'equipment',
    division: 'Roofing',
    sortOrder: 910,
  },
  {
    code: '07-0000-SAFETY-HARNESS',
    description: 'Safety Harness / PFAS Day Rate',
    category: 'equipment',
    division: 'Roofing',
    sortOrder: 920,
  },

  // --- Subcontract / other ---
  {
    code: '07-0000-SUB-INSPECTION',
    description: 'Third-Party Roof Inspection',
    category: 'subcontract',
    division: 'Roofing',
    sortOrder: 1000,
  },
  {
    code: '07-0000-SUB-WARRANTY',
    description: 'Manufacturer Warranty Service Fee',
    category: 'subcontract',
    division: 'Roofing',
    sortOrder: 1010,
  },
  {
    code: '07-0000-TEMP-PROTECTION',
    description: 'Temporary Roof Protection (during phased work)',
    category: 'other',
    division: 'Roofing',
    sortOrder: 1100,
  },
  {
    code: '07-0000-DISPOSAL',
    description: 'Roofing Debris Disposal / Tipping Fees',
    category: 'other',
    division: 'Roofing',
    sortOrder: 1110,
  },
];

export type RoofingSeedResult = {
  inserted: number;
  skipped: number;
  skippedCodes: string[];
};
