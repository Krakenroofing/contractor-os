// Bahamas Tariff Library — demo seed.
// Rates here are illustrative and must be verified against the current
// Bahamas Customs Tariff Schedule and/or a customs broker before use.

export const TARIFF_CATEGORIES = [
  'construction_materials',
  'roofing_windows_doors',
  'tools_equipment',
  'household_goods',
  'furniture',
  'appliances',
  'clothing_uniforms',
  'electronics',
  'vehicles_parts',
  'marine_boat',
  'food_beverage',
  'cleaning_supplies',
  'office_supplies',
  'general',
] as const;
export type TariffCategory = (typeof TARIFF_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<TariffCategory, string> = {
  construction_materials: 'Construction materials',
  roofing_windows_doors: 'Roofing / windows / doors',
  tools_equipment: 'Tools & equipment',
  household_goods: 'Household goods',
  furniture: 'Furniture',
  appliances: 'Appliances',
  clothing_uniforms: 'Clothing & uniforms',
  electronics: 'Electronics',
  vehicles_parts: 'Vehicles & parts',
  marine_boat: 'Marine / boat',
  food_beverage: 'Food & beverage',
  cleaning_supplies: 'Cleaning supplies',
  office_supplies: 'Office supplies',
  general: 'General / miscellaneous',
};

export const CONSTRUCTION_CATEGORIES: TariffCategory[] = [
  'construction_materials',
  'roofing_windows_doors',
  'tools_equipment',
];

export const HOUSEHOLD_CATEGORIES: TariffCategory[] = [
  'household_goods',
  'furniture',
  'appliances',
  'clothing_uniforms',
  'electronics',
];

export type TariffRecord = {
  id: string;
  tariffCode: string;
  description: string;
  category: TariffCategory;
  dutyPercent: number;
  vatPercent: number;
  envLevyPercent: number;
  excisePercent: number;
  processingFeeNotes: string;
  requiredPermits: string;
  sourceReference: string;
  effectiveDate: string;
  isActive: boolean;
  isFrequentlyUsed: boolean;
  internalNotes: string;
};

const DEFAULT_REF = 'Bahamas Customs Tariff Schedule (illustrative — verify before use)';

function tariff(
  over: Partial<TariffRecord> &
    Pick<TariffRecord, 'tariffCode' | 'description' | 'category' | 'dutyPercent' | 'vatPercent'>,
): TariffRecord {
  return {
    id: `${over.tariffCode}-${over.category}`,
    envLevyPercent: 0,
    excisePercent: 0,
    processingFeeNotes: '',
    requiredPermits: '',
    sourceReference: DEFAULT_REF,
    effectiveDate: '2024-01-01',
    isActive: true,
    isFrequentlyUsed: false,
    internalNotes: '',
    ...over,
  };
}

export const SEED_TARIFF_LIBRARY: TariffRecord[] = [
  // ===== Construction materials =====
  tariff({
    tariffCode: '6807.10.00',
    description: 'Asphalt shingles & roofing felt',
    category: 'construction_materials',
    dutyPercent: 5,
    vatPercent: 10,
    isFrequentlyUsed: true,
    internalNotes: 'Standard Kraken roofing import.',
  }),
  tariff({
    tariffCode: '4407.11.00',
    description: 'Dimensional softwood lumber (pine/spruce)',
    category: 'construction_materials',
    dutyPercent: 0,
    vatPercent: 10,
    isFrequentlyUsed: true,
    internalNotes: 'CARICOM duty waiver applies in many cases.',
  }),
  tariff({
    tariffCode: '7308.90.00',
    description: 'Steel structural members',
    category: 'construction_materials',
    dutyPercent: 7.5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '2523.29.00',
    description: 'Portland cement (other)',
    category: 'construction_materials',
    dutyPercent: 0,
    vatPercent: 10,
    isFrequentlyUsed: true,
  }),
  tariff({
    tariffCode: '6810.11.00',
    description: 'Concrete blocks & bricks',
    category: 'construction_materials',
    dutyPercent: 0,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '7317.00.00',
    description: 'Roofing nails, screws & fasteners (steel)',
    category: 'construction_materials',
    dutyPercent: 5,
    vatPercent: 10,
    isFrequentlyUsed: true,
  }),
  tariff({
    tariffCode: '3917.21.00',
    description: 'PVC pipes & fittings',
    category: 'construction_materials',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8302.50.00',
    description: "Builders' hardware (hinges, brackets, hat & coat hooks)",
    category: 'construction_materials',
    dutyPercent: 5,
    vatPercent: 10,
  }),

  // ===== Roofing / windows / doors =====
  tariff({
    tariffCode: '7308.30.00',
    description: 'Steel doors, windows & frames',
    category: 'roofing_windows_doors',
    dutyPercent: 5,
    vatPercent: 10,
    envLevyPercent: 1,
    isFrequentlyUsed: true,
  }),
  tariff({
    tariffCode: '7610.10.00',
    description: 'Aluminum windows, doors & frames',
    category: 'roofing_windows_doors',
    dutyPercent: 5,
    vatPercent: 10,
    envLevyPercent: 1,
    isFrequentlyUsed: true,
  }),
  tariff({
    tariffCode: '4418.20.00',
    description: 'Wooden doors & door frames',
    category: 'roofing_windows_doors',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '7007.21.00',
    description: 'Tempered safety glass for buildings',
    category: 'roofing_windows_doors',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8302.41.00',
    description: 'Door & window furniture (handles, locks)',
    category: 'roofing_windows_doors',
    dutyPercent: 5,
    vatPercent: 10,
  }),

  // ===== Tools & equipment =====
  tariff({
    tariffCode: '8205.59.00',
    description: 'Hand tools (other)',
    category: 'tools_equipment',
    dutyPercent: 5,
    vatPercent: 10,
    isFrequentlyUsed: true,
  }),
  tariff({
    tariffCode: '8467.21.00',
    description: 'Power drills (handheld, electric)',
    category: 'tools_equipment',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8413.70.00',
    description: 'Centrifugal pumps',
    category: 'tools_equipment',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '9405.10.00',
    description: 'Lighting fixtures (chandeliers, ceiling)',
    category: 'tools_equipment',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8425.31.00',
    description: 'Hoists & cranes (powered, ≤2 tonnes)',
    category: 'tools_equipment',
    dutyPercent: 5,
    vatPercent: 10,
  }),

  // ===== Household goods =====
  tariff({
    tariffCode: '6302.21.00',
    description: 'Bed linens (cotton, printed)',
    category: 'household_goods',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '6302.51.00',
    description: 'Cotton table linens',
    category: 'household_goods',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '6911.10.00',
    description: 'Porcelain dinnerware & tableware',
    category: 'household_goods',
    dutyPercent: 35,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '7013.49.00',
    description: 'Glass kitchenware (other)',
    category: 'household_goods',
    dutyPercent: 35,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '4419.90.00',
    description: 'Wooden tableware & kitchenware',
    category: 'household_goods',
    dutyPercent: 25,
    vatPercent: 10,
  }),

  // ===== Furniture =====
  tariff({
    tariffCode: '9403.30.00',
    description: 'Wooden office furniture',
    category: 'furniture',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '9403.60.00',
    description: 'Other wooden furniture',
    category: 'furniture',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '9404.21.00',
    description: 'Foam mattresses (cellular rubber/plastic)',
    category: 'furniture',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '9401.61.00',
    description: 'Upholstered seating with wooden frames',
    category: 'furniture',
    dutyPercent: 25,
    vatPercent: 10,
  }),

  // ===== Appliances =====
  tariff({
    tariffCode: '8418.10.00',
    description: 'Refrigerators (combined fridge-freezer)',
    category: 'appliances',
    dutyPercent: 25,
    vatPercent: 10,
    envLevyPercent: 5,
    processingFeeNotes: 'White-goods environmental levy applies.',
  }),
  tariff({
    tariffCode: '8450.11.00',
    description: 'Washing machines (≤10 kg, fully automatic)',
    category: 'appliances',
    dutyPercent: 25,
    vatPercent: 10,
    envLevyPercent: 5,
  }),
  tariff({
    tariffCode: '8516.50.00',
    description: 'Microwave ovens',
    category: 'appliances',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8415.10.00',
    description: 'HVAC / split AC units',
    category: 'appliances',
    dutyPercent: 5,
    vatPercent: 7.5,
    isFrequentlyUsed: true,
    internalNotes: 'Reduced VAT on energy-efficient HVAC.',
  }),
  tariff({
    tariffCode: '8508.11.00',
    description: 'Vacuum cleaners (≤1500 W)',
    category: 'appliances',
    dutyPercent: 25,
    vatPercent: 10,
  }),

  // ===== Clothing & uniforms =====
  tariff({
    tariffCode: '6203.42.00',
    description: "Men's cotton trousers",
    category: 'clothing_uniforms',
    dutyPercent: 35,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '6204.62.00',
    description: "Women's cotton trousers",
    category: 'clothing_uniforms',
    dutyPercent: 35,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '6109.10.00',
    description: 'Cotton T-shirts',
    category: 'clothing_uniforms',
    dutyPercent: 35,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '6403.99.00',
    description: 'Leather footwear (other)',
    category: 'clothing_uniforms',
    dutyPercent: 35,
    vatPercent: 10,
  }),

  // ===== Electronics =====
  tariff({
    tariffCode: '8517.13.00',
    description: 'Smartphones',
    category: 'electronics',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8471.30.00',
    description: 'Laptop & portable computers',
    category: 'electronics',
    dutyPercent: 0,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8528.72.00',
    description: 'TV monitors / receivers',
    category: 'electronics',
    dutyPercent: 25,
    vatPercent: 10,
    envLevyPercent: 5,
  }),
  tariff({
    tariffCode: '8519.81.00',
    description: 'Sound recording / reproducing devices',
    category: 'electronics',
    dutyPercent: 25,
    vatPercent: 10,
  }),

  // ===== Vehicles & parts =====
  tariff({
    tariffCode: '8703.21.00',
    description: 'Motor cars (≤1L engine)',
    category: 'vehicles_parts',
    dutyPercent: 65,
    vatPercent: 10,
    envLevyPercent: 5,
    requiredPermits:
      'Vehicle import permit + bill of sale + manufacturer certificate. Right-hand-drive restrictions apply.',
    processingFeeNotes: 'Stamp duty + environmental levy by engine size.',
    internalNotes:
      'Bahamas vehicle duty is tiered by engine displacement / CIF; verify the exact band before quoting.',
  }),
  tariff({
    tariffCode: '8708.10.00',
    description: 'Bumpers & parts (motor vehicles)',
    category: 'vehicles_parts',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '4011.10.00',
    description: 'Pneumatic tires (passenger cars)',
    category: 'vehicles_parts',
    dutyPercent: 25,
    vatPercent: 10,
    envLevyPercent: 5,
    processingFeeNotes: 'Tire environmental levy applies.',
  }),

  // ===== Marine / boat =====
  tariff({
    tariffCode: '8903.91.00',
    description: 'Sailboats with or without auxiliary motor',
    category: 'marine_boat',
    dutyPercent: 0,
    vatPercent: 10,
    requiredPermits: 'Marine vessel registration + Port Department clearance.',
  }),
  tariff({
    tariffCode: '8903.92.00',
    description: 'Motorboats (other than outboard)',
    category: 'marine_boat',
    dutyPercent: 5,
    vatPercent: 10,
    requiredPermits: 'Marine vessel registration + Port Department clearance.',
  }),
  tariff({
    tariffCode: '8407.21.00',
    description: 'Outboard marine engines (≤325 kW)',
    category: 'marine_boat',
    dutyPercent: 5,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '6306.12.00',
    description: 'Tarpaulins, awnings, sails',
    category: 'marine_boat',
    dutyPercent: 5,
    vatPercent: 10,
  }),

  // ===== Food / beverage =====
  tariff({
    tariffCode: '1006.30.00',
    description: 'Milled rice (semi/wholly milled)',
    category: 'food_beverage',
    dutyPercent: 0,
    vatPercent: 0,
    internalNotes: 'Zero-rated essential.',
  }),
  tariff({
    tariffCode: '0701.90.00',
    description: 'Potatoes, fresh or chilled',
    category: 'food_beverage',
    dutyPercent: 0,
    vatPercent: 0,
    internalNotes: 'Zero-rated essential.',
  }),
  tariff({
    tariffCode: '2202.10.00',
    description: 'Sweetened soft drinks',
    category: 'food_beverage',
    dutyPercent: 25,
    vatPercent: 10,
    excisePercent: 10,
    processingFeeNotes: 'Sugar-sweetened beverage excise applies.',
  }),
  tariff({
    tariffCode: '2204.21.00',
    description: 'Bottled wine (≤2L containers)',
    category: 'food_beverage',
    dutyPercent: 70,
    vatPercent: 10,
    excisePercent: 30,
    requiredPermits: 'Liquor importation license required.',
  }),
  tariff({
    tariffCode: '2208.30.00',
    description: 'Whiskies',
    category: 'food_beverage',
    dutyPercent: 110,
    vatPercent: 10,
    excisePercent: 50,
    requiredPermits: 'Liquor importation license required.',
  }),

  // ===== Cleaning supplies =====
  tariff({
    tariffCode: '3402.20.00',
    description: 'Detergents & cleaning agents',
    category: 'cleaning_supplies',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '3401.11.00',
    description: 'Soap (toilet, including medicated)',
    category: 'cleaning_supplies',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '4818.10.00',
    description: 'Toilet paper',
    category: 'cleaning_supplies',
    dutyPercent: 25,
    vatPercent: 10,
  }),

  // ===== Office supplies =====
  tariff({
    tariffCode: '4820.10.00',
    description: 'Notebooks, ledgers, exercise books',
    category: 'office_supplies',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '9608.10.00',
    description: 'Ballpoint pens',
    category: 'office_supplies',
    dutyPercent: 25,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '8443.32.00',
    description: 'Office printers / multi-function devices',
    category: 'office_supplies',
    dutyPercent: 5,
    vatPercent: 10,
  }),

  // ===== General / miscellaneous =====
  tariff({
    tariffCode: '4202.21.00',
    description: 'Leather handbags',
    category: 'general',
    dutyPercent: 35,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '7113.19.00',
    description: 'Articles of jewellery (precious metal)',
    category: 'general',
    dutyPercent: 35,
    vatPercent: 10,
    requiredPermits: 'Customs valuation review for high-value items.',
  }),
  tariff({
    tariffCode: '9503.00.00',
    description: 'Toys (non-battery operated)',
    category: 'general',
    dutyPercent: 35,
    vatPercent: 10,
  }),
  tariff({
    tariffCode: '9999.00.00',
    description: 'General / unclassified',
    category: 'general',
    dutyPercent: 25,
    vatPercent: 10,
    internalNotes: 'Default fallback when no specific code applies.',
  }),
];

export const CARRIERS = [
  'Tropical',
  'Betty K',
  "Pender's",
  'Elite Customs Brokers',
  'Other',
] as const;
