import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  ChangeOrder,
  ChangeOrderLineItem,
  Company,
  CostCode,
  Customer,
  Estimate,
  EstimateLineItem,
  JobCostEntry,
  LaborEntry,
  LandedCost,
  Project,
  Proposal,
  PurchaseOrder,
  PurchaseOrderLine,
  Vendor,
} from '@/db/schema';

// Stable IDs so cookies / cross-references survive HMR.
export const KRAKEN_ID = '00000000-0000-0000-0000-000000000001';
export const TRB_ID = '00000000-0000-0000-0000-000000000002';
export const KRAKEN_LIBRARY_ID = '00000000-0000-0000-0000-000000000010';
export const TRB_LIBRARY_ID = '00000000-0000-0000-0000-000000000011';

// Backward-compat alias for any callers still referencing this.
export const MOCK_COMPANY_ID = KRAKEN_ID;
export const DEFAULT_COST_CODE_LIBRARY_ID = KRAKEN_LIBRARY_ID;

const LIBRARY_BY_COMPANY: Record<string, string> = {
  [KRAKEN_ID]: KRAKEN_LIBRARY_ID,
  [TRB_ID]: TRB_LIBRARY_ID,
};

type Store = {
  companies: Company[];
  customers: Customer[];
  projects: Project[];
  costCodes: CostCode[];
  estimates: Estimate[];
  estimateLineItems: EstimateLineItem[];
  proposals: Proposal[];
  changeOrders: ChangeOrder[];
  changeOrderLineItems: ChangeOrderLineItem[];
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  laborEntries: LaborEntry[];
  jobCostEntries: JobCostEntry[];
  landedCosts: LandedCost[];
};

declare global {
  // Persist mock store across HMR reloads in dev.
  var __contractorOsMockStore: Store | undefined;
}

// =====================================================================
// builders
// =====================================================================

function makeCompany(over: Partial<Company> & Pick<Company, 'id' | 'name' | 'slug'>): Company {
  const now = new Date();
  return {
    id: over.id,
    name: over.name,
    slug: over.slug,
    logoUrl: null,
    email: null,
    phone: null,
    website: null,
    licenseNumber: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    defaultCurrency: 'USD',
    defaultMarkupPercent: '20',
    taxRatePercent: '0',
    vatRatePercent: '0',
    proposalValidityDays: 30,
    standardPaymentTerms: null,
    standardWarrantyLanguage: null,
    fiscalYearStartMonth: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeCustomer(
  companyId: string,
  over: Partial<Customer> & Pick<Customer, 'name'>,
): Customer {
  const now = new Date();
  return {
    id: randomUUID(),
    companyId,
    name: over.name,
    primaryContactName: null,
    email: null,
    phone: null,
    customerType: 'residential',
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingCity: null,
    billingState: null,
    billingPostalCode: null,
    notes: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeProject(
  companyId: string,
  over: Partial<Project> & Pick<Project, 'customerId' | 'number' | 'name'>,
): Project {
  const now = new Date();
  return {
    id: randomUUID(),
    companyId,
    customerId: over.customerId,
    number: over.number,
    name: over.name,
    status: 'lead',
    jobsiteAddressLine1: null,
    jobsiteAddressLine2: null,
    jobsiteCity: null,
    jobsiteState: null,
    jobsitePostalCode: null,
    projectManagerId: null,
    estimatorId: null,
    startDate: null,
    targetCompletionDate: null,
    actualCompletionDate: null,
    contractValue: '0',
    originalContractValue: '0',
    totalChangeOrders: '0',
    currentBudget: '0',
    notes: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeCostCode(
  libraryId: string,
  over: Pick<CostCode, 'code' | 'description' | 'category'>,
): CostCode {
  const now = new Date();
  return {
    id: randomUUID(),
    libraryId,
    code: over.code,
    description: over.description,
    category: over.category,
    createdAt: now,
    updatedAt: now,
  };
}

function makeVendor(
  companyId: string,
  over: Partial<Vendor> & Pick<Vendor, 'name'>,
): Vendor {
  const now = new Date();
  return {
    id: randomUUID(),
    companyId,
    name: over.name,
    primaryContactName: null,
    email: null,
    phone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    defaultTerms: null,
    taxIdLast4: null,
    isSubcontractor: false,
    w9OnFile: false,
    notes: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

type SeedLandedCost = {
  companyId: string;
  projectId: string | null;
  name: string;
  carrier: string;
  materialCost: number;
  flDelivery: number;
  crating: number;
  freightCost: number;
  insurance: number;
  dutyPercent: number;
  vatPercent: number;
  brokerage: number;
  portFees: number;
  localDelivery: number;
  quantity: number;
  notes?: string;
};

function buildLandedCost(input: SeedLandedCost): LandedCost {
  const fob = input.materialCost + input.flDelivery + input.crating;
  const cif = fob + input.freightCost + input.insurance;
  const dutyAmount = cif * (input.dutyPercent / 100);
  const vatAmount = (cif + dutyAmount) * (input.vatPercent / 100);
  const localFees = input.brokerage + input.portFees + input.localDelivery;
  const total = cif + dutyAmount + vatAmount + localFees;
  const perUnit = input.quantity > 0 ? total / input.quantity : 0;
  const now = new Date();
  return {
    id: randomUUID(),
    companyId: input.companyId,
    projectId: input.projectId,
    vendorId: null,
    name: input.name,
    carrier: input.carrier,
    itemDescription: null,
    tariffCode: null,
    unitCost: '0.0000',
    materialCost: input.materialCost.toFixed(2),
    flDelivery: input.flDelivery.toFixed(2),
    crating: input.crating.toFixed(2),
    freightCost: input.freightCost.toFixed(2),
    insurance: input.insurance.toFixed(2),
    dutyPercent: input.dutyPercent.toFixed(3),
    vatPercent: input.vatPercent.toFixed(3),
    envLevyPercent: '0.000',
    envLevyAmount: '0.00',
    excisePercent: '0.000',
    exciseAmount: '0.00',
    brokerage: input.brokerage.toFixed(2),
    portFees: input.portFees.toFixed(2),
    localDelivery: input.localDelivery.toFixed(2),
    quantity: input.quantity.toFixed(4),
    fob: fob.toFixed(2),
    cif: cif.toFixed(2),
    dutyAmount: dutyAmount.toFixed(2),
    vatAmount: vatAmount.toFixed(2),
    totalLandedCost: total.toFixed(2),
    perUnitCost: perUnit.toFixed(4),
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

type SeedLabor = {
  companyId: string;
  projectId: string;
  costCode: string;
  workerName: string;
  workDate: string;
  hours: number;
  rate: number;
  notes?: string;
};

function buildLabor(seed: SeedLabor, codeLookup: Map<string, CostCode>): LaborEntry {
  const code = codeLookup.get(seed.costCode);
  if (!code) throw new Error(`Seed cost code not found: ${seed.costCode}`);
  const amount = seed.hours * seed.rate;
  const now = new Date();
  return {
    id: randomUUID(),
    companyId: seed.companyId,
    projectId: seed.projectId,
    costCodeId: code.id,
    userId: null,
    workerName: seed.workerName,
    workDate: seed.workDate,
    hours: seed.hours.toFixed(2),
    rate: seed.rate.toFixed(4),
    burdenPercent: '0.000',
    amount: amount.toFixed(2),
    notes: seed.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

type SeedPOLine = {
  costCode: string;
  description?: string;
  unit: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
};

type SeedPurchaseOrder = {
  companyId: string;
  number: string;
  projectId: string;
  vendorId: string;
  status: PurchaseOrder['status'];
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  taxAmount: number;
  shipping: number;
  notes: string | null;
  lines: SeedPOLine[];
};

function buildPurchaseOrder(
  input: SeedPurchaseOrder,
  codeLookup: Map<string, CostCode>,
): { po: PurchaseOrder; lines: PurchaseOrderLine[] } {
  const now = new Date();
  const poId = randomUUID();
  let subtotal = 0;

  const lines: PurchaseOrderLine[] = input.lines.map((sl, i) => {
    const code = codeLookup.get(sl.costCode);
    if (!code) throw new Error(`Seed cost code not found: ${sl.costCode}`);
    const lineTotal = sl.quantityOrdered * sl.unitCost;
    subtotal += lineTotal;
    return {
      id: randomUUID(),
      purchaseOrderId: poId,
      costCodeId: code.id,
      description: sl.description ?? code.description,
      unit: sl.unit,
      quantityOrdered: sl.quantityOrdered.toFixed(4),
      quantityReceived: sl.quantityReceived.toFixed(4),
      unitCost: sl.unitCost.toFixed(4),
      lineTotal: lineTotal.toFixed(2),
      sortOrder: i,
    };
  });

  const total = subtotal + input.taxAmount + input.shipping;

  const po: PurchaseOrder = {
    id: poId,
    companyId: input.companyId,
    projectId: input.projectId,
    vendorId: input.vendorId,
    landedCostEntryId: null,
    number: input.number,
    status: input.status,
    issueDate: input.issueDate,
    expectedDeliveryDate: input.expectedDeliveryDate,
    shipToAddressLine1: null,
    shipToCity: null,
    shipToState: null,
    shipToPostalCode: null,
    subtotal: subtotal.toFixed(2),
    taxAmount: input.taxAmount.toFixed(2),
    shipping: input.shipping.toFixed(2),
    total: total.toFixed(2),
    notes: input.notes,
    issuedAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
    closedAt: input.status === 'closed' ? now : null,
    createdAt: now,
    updatedAt: now,
  };

  return { po, lines };
}

type SeedChangeOrderLine = {
  costCode: string;
  description?: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
};

type SeedChangeOrder = {
  companyId: string;
  number: string;
  projectId: string;
  proposalId: string | null;
  status: ChangeOrder['status'];
  reason: ChangeOrder['reason'];
  description: string;
  scheduleImpactDays: number;
  submittedAt: string | null;
  approvedAt: string | null;
  customerSignedName?: string;
  lines: SeedChangeOrderLine[];
};

function buildChangeOrder(
  input: SeedChangeOrder,
  codeLookup: Map<string, CostCode>,
): { co: ChangeOrder; lines: ChangeOrderLineItem[] } {
  const now = new Date();
  const coId = randomUUID();
  let subtotal = 0;
  let total = 0;

  const lines: ChangeOrderLineItem[] = input.lines.map((sl, i) => {
    const code = codeLookup.get(sl.costCode);
    if (!code) throw new Error(`Seed cost code not found: ${sl.costCode}`);
    const cost = sl.quantity * sl.unitCost;
    const sell = cost * (1 + sl.markupPercent / 100);
    subtotal += cost;
    total += sell;
    return {
      id: randomUUID(),
      changeOrderId: coId,
      costCodeId: code.id,
      description: sl.description ?? code.description,
      unit: sl.unit,
      quantity: sl.quantity.toFixed(4),
      unitCost: sl.unitCost.toFixed(4),
      markupPercent: sl.markupPercent.toFixed(3),
      lineTotal: sell.toFixed(2),
      sortOrder: i,
    };
  });

  const co: ChangeOrder = {
    id: coId,
    companyId: input.companyId,
    projectId: input.projectId,
    proposalId: input.proposalId,
    number: input.number,
    status: input.status,
    reason: input.reason,
    description: input.description,
    subtotal: subtotal.toFixed(2),
    taxAmount: '0.00',
    total: total.toFixed(2),
    scheduleImpactDays: input.scheduleImpactDays,
    publicToken: null,
    submittedAt: input.submittedAt,
    sentAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
    customerSignedAt: input.status === 'approved' ? now : null,
    customerSignedName: input.customerSignedName ?? null,
    customerSignedIp: null,
    approvedAt: input.approvedAt,
    rejectedAt:
      input.status === 'rejected' ? new Date().toISOString().slice(0, 10) : null,
    createdAt: now,
    updatedAt: now,
  };

  return { co, lines };
}

type SeedProposal = {
  companyId: string;
  number: string;
  projectId: string;
  estimateId: string;
  total: string;
  status: Proposal['status'];
  proposalDate: string | null;
  expiryDate: string | null;
  scopeOfWork: string;
  inclusions: string;
  exclusions: string;
  paymentSchedule: string;
  warrantyNotes: string;
  termsAndConditions: string;
  signedByName?: string;
  signedByEmail?: string;
};

function buildProposal(input: SeedProposal): Proposal {
  const now = new Date();
  return {
    id: randomUUID(),
    companyId: input.companyId,
    projectId: input.projectId,
    estimateId: input.estimateId,
    templateId: null,
    number: input.number,
    version: 1,
    status: input.status,
    proposalDate: input.proposalDate,
    expiryDate: input.expiryDate,
    total: input.total,
    scopeOfWork: input.scopeOfWork,
    inclusions: input.inclusions,
    exclusions: input.exclusions,
    paymentSchedule: input.paymentSchedule,
    warrantyNotes: input.warrantyNotes,
    termsAndConditions: input.termsAndConditions,
    pdfUrl: null,
    publicToken: null,
    sentAt: input.status !== 'draft' ? now : null,
    viewedAt:
      input.status === 'viewed' ||
      input.status === 'accepted' ||
      input.status === 'declined'
        ? now
        : null,
    acceptedAt: input.status === 'accepted' ? now : null,
    declinedAt: input.status === 'declined' ? now : null,
    signatureImageUrl: null,
    signedByName: input.signedByName ?? null,
    signedByEmail: input.signedByEmail ?? null,
    signedIp: null,
    createdAt: now,
    updatedAt: now,
  };
}

type SeedLine = {
  costCode: string;
  description?: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
};

function buildEstimateAndLines(
  companyId: string,
  number: string,
  projectId: string,
  status: Estimate['status'],
  validUntil: string | null,
  seedLines: SeedLine[],
  codeLookup: Map<string, CostCode>,
): { estimate: Estimate; lines: EstimateLineItem[] } {
  const now = new Date();
  const estimateId = randomUUID();
  let subtotal = 0;
  let total = 0;

  const lines: EstimateLineItem[] = seedLines.map((sl, i) => {
    const code = codeLookup.get(sl.costCode);
    if (!code) throw new Error(`Seed cost code not found: ${sl.costCode}`);
    const cost = sl.quantity * sl.unitCost;
    const sell = cost * (1 + sl.markupPercent / 100);
    subtotal += cost;
    total += sell;
    return {
      id: randomUUID(),
      estimateId,
      sectionId: null,
      costCodeId: code.id,
      assemblyId: null,
      description: sl.description ?? code.description,
      unit: sl.unit,
      quantity: sl.quantity.toFixed(4),
      unitCost: sl.unitCost.toFixed(4),
      markupPercent: sl.markupPercent.toFixed(3),
      lineTotal: sell.toFixed(2),
      sortOrder: i,
    };
  });

  const estimate: Estimate = {
    id: estimateId,
    companyId,
    projectId,
    number,
    version: 1,
    status,
    subtotal: subtotal.toFixed(2),
    taxAmount: '0.00',
    total: total.toFixed(2),
    markupPercent: '0.000',
    overheadPercent: '0.000',
    validUntil,
    sentAt: status === 'sent' || status === 'approved' || status === 'rejected' ? now : null,
    approvedAt: status === 'approved' ? now : null,
    parentEstimateId: null,
    createdAt: now,
    updatedAt: now,
  };

  return { estimate, lines };
}

// =====================================================================
// seed
// =====================================================================

function seed(): Store {
  // ---------- Companies ----------
  const kraken = makeCompany({
    id: KRAKEN_ID,
    name: 'Kraken Roofing',
    slug: 'kraken-roofing',
    email: 'ops@krakenroofing.example',
    phone: '(242) 555-0100',
    website: 'krakenroofing.example',
    licenseNumber: 'BHS-LIC-RC-2024-1138',
    addressLine1: '1234 Coral Ave',
    city: 'Nassau',
    state: 'New Providence',
    postalCode: 'N-1234',
    defaultMarkupPercent: '22',
    taxRatePercent: '0',
    vatRatePercent: '10',
    proposalValidityDays: 30,
    standardPaymentTerms:
      '30% deposit due upon contract signing.\n50% due upon material delivery to jobsite.\n20% balance due upon substantial completion and final inspection.\nNet-30 invoicing for commercial accounts.',
    standardWarrantyLanguage:
      '10-year workmanship warranty against installation defects.\nManufacturer materials warranty per product certificate (typically 25–50 years on architectural shingles, 15–20 years on TPO).\nWarranty registration submitted within 30 days of completion.',
  });
  const trb = makeCompany({
    id: TRB_ID,
    name: 'TRB Ltd.',
    slug: 'trb-ltd',
    email: 'hello@trbltd.example',
    phone: '(242) 555-0200',
    website: 'trbltd.example',
    licenseNumber: 'BHS-LIC-GC-2024-2200',
    addressLine1: '500 Bay St',
    city: 'Nassau',
    state: 'New Providence',
    postalCode: 'N-2200',
    defaultMarkupPercent: '18',
    taxRatePercent: '0',
    vatRatePercent: '10',
    proposalValidityDays: 21,
    standardPaymentTerms:
      '25% deposit due upon contract signing.\nProgress billing monthly, due Net 15.\n10% retainage held until punch-list completion and Owner sign-off.',
    standardWarrantyLanguage:
      '5-year workmanship warranty.\nManufacturer materials warranty pass-through; certificates delivered at handover.\nAnnual courtesy inspection in year one at no additional charge.',
  });

  // ---------- Kraken seed ----------
  const acme = makeCustomer(KRAKEN_ID, {
    name: 'Acme Property Management',
    customerType: 'commercial',
    primaryContactName: 'Dana Holt',
    email: 'dana@acme.example',
    phone: '(303) 555-0142',
  });
  const smith = makeCustomer(KRAKEN_ID, {
    name: 'Smith Residence',
    primaryContactName: 'Jane Smith',
    email: 'jane@example.com',
    phone: '(303) 555-0188',
  });
  const garcia = makeCustomer(KRAKEN_ID, {
    name: 'Garcia Family',
    primaryContactName: 'Luis Garcia',
    phone: '(720) 555-0211',
  });

  const smithProject = makeProject(KRAKEN_ID, {
    customerId: smith.id,
    number: '2026-001',
    name: 'Smith residence — full roof replacement',
    status: 'in_progress',
    jobsiteAddressLine1: '142 Maple St',
    jobsiteCity: 'Boulder',
    jobsiteState: 'CO',
    jobsitePostalCode: '80301',
    startDate: '2026-04-15',
    targetCompletionDate: '2026-05-10',
    contractValue: '28500.00',
    originalContractValue: '26000.00',
    totalChangeOrders: '2500.00',
    currentBudget: '21500.00',
    notes:
      'Tear off existing 3-tab, install architectural shingle. Two skylights to flash.',
  });
  const sunsetProject = makeProject(KRAKEN_ID, {
    customerId: acme.id,
    number: '2026-002',
    name: 'Sunset Plaza — TPO recoat (3 buildings)',
    status: 'won',
    jobsiteAddressLine1: '500 Sunset Blvd',
    jobsiteCity: 'Lakewood',
    jobsiteState: 'CO',
    jobsitePostalCode: '80228',
    startDate: '2026-05-05',
    targetCompletionDate: '2026-06-30',
    contractValue: '142000.00',
    originalContractValue: '142000.00',
    totalChangeOrders: '0',
    currentBudget: '108000.00',
  });
  const garciaProject = makeProject(KRAKEN_ID, {
    customerId: garcia.id,
    number: '2026-003',
    name: 'Garcia kitchen remodel',
    status: 'estimating',
    jobsiteAddressLine1: '88 Pinecrest Dr',
    jobsiteCity: 'Arvada',
    jobsiteState: 'CO',
    jobsitePostalCode: '80004',
    contractValue: '0.00',
  });

  const krakenCostCodes: CostCode[] = [
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '01-100', description: 'Roof Tear-Off', category: 'labor' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '01-200', description: 'Sheathing & Decking Repair', category: 'labor' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '01-300', description: 'Underlayment Install', category: 'labor' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '01-400', description: 'Shingle / TPO Install', category: 'labor' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '01-500', description: 'Flashing & Trim', category: 'labor' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '02-100', description: 'Asphalt Shingles', category: 'material' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '02-200', description: 'Underlayment / Felt', category: 'material' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '02-300', description: 'Drip Edge & Flashing', category: 'material' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '02-400', description: 'Plywood Sheathing', category: 'material' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '02-500', description: 'Roofing Nails & Fasteners', category: 'material' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '03-100', description: 'Dumpster / Disposal', category: 'subcontract' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '03-200', description: 'Gutter Subcontractor', category: 'subcontract' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '04-100', description: 'Scaffolding Rental', category: 'equipment' }),
    makeCostCode(KRAKEN_LIBRARY_ID, { code: '04-200', description: 'Air Compressor & Tools', category: 'equipment' }),
  ];

  const krakenCodeLookup = new Map(krakenCostCodes.map((c) => [c.code, c]));

  const smithEstimate = buildEstimateAndLines(
    KRAKEN_ID,
    'EST-2026-001',
    smithProject.id,
    'approved',
    '2026-04-30',
    [
      { costCode: '01-100', unit: 'sq', quantity: 22, unitCost: 80, markupPercent: 20 },
      { costCode: '01-200', unit: 'sq ft', quantity: 200, unitCost: 4.5, markupPercent: 20 },
      { costCode: '01-300', unit: 'sq', quantity: 22, unitCost: 25, markupPercent: 25 },
      { costCode: '01-400', unit: 'sq', quantity: 22, unitCost: 120, markupPercent: 25 },
      { costCode: '02-100', unit: 'sq', quantity: 22, unitCost: 145, markupPercent: 15 },
      { costCode: '02-200', unit: 'sq', quantity: 22, unitCost: 35, markupPercent: 15 },
      { costCode: '02-300', unit: 'ea', quantity: 1, unitCost: 450, markupPercent: 20 },
      { costCode: '03-100', unit: 'ea', quantity: 1, unitCost: 625, markupPercent: 10 },
    ],
    krakenCodeLookup,
  );

  const sunsetEstimate = buildEstimateAndLines(
    KRAKEN_ID,
    'EST-2026-002',
    sunsetProject.id,
    'sent',
    '2026-05-15',
    [
      { costCode: '01-400', unit: 'sq', quantity: 380, unitCost: 95, markupPercent: 18 },
      { costCode: '02-100', unit: 'sq', quantity: 380, unitCost: 110, markupPercent: 15 },
      { costCode: '01-500', unit: 'lf', quantity: 1200, unitCost: 8, markupPercent: 22 },
      { costCode: '04-100', unit: 'mo', quantity: 2, unitCost: 1800, markupPercent: 10 },
    ],
    krakenCodeLookup,
  );

  const garciaEstimate = buildEstimateAndLines(
    KRAKEN_ID,
    'EST-2026-003',
    garciaProject.id,
    'draft',
    null,
    [
      { costCode: '01-200', unit: 'sq ft', quantity: 240, unitCost: 6, markupPercent: 25 },
      { costCode: '02-400', unit: 'sheet', quantity: 12, unitCost: 58, markupPercent: 20 },
    ],
    krakenCodeLookup,
  );

  const smithProposal = buildProposal({
    companyId: KRAKEN_ID,
    number: 'PROP-2026-001',
    projectId: smithProject.id,
    estimateId: smithEstimate.estimate.id,
    total: smithEstimate.estimate.total,
    status: 'accepted',
    proposalDate: '2026-04-01',
    expiryDate: '2026-05-01',
    scopeOfWork:
      'Tear off and dispose of existing 3-tab asphalt shingles. Inspect and repair damaged sheathing as needed. Install ice & water shield in valleys and along eaves. Install synthetic underlayment over remaining roof deck. Install architectural asphalt shingles per manufacturer specifications. Install new drip edge and step flashing at all roof-to-wall transitions. Install new pipe boots and re-flash both skylights.',
    inclusions:
      'All labor, materials, equipment, dump fees, and permits required to complete the scope of work.\nDaily site cleanup and removal of all roofing debris from the property at completion.\nFinal magnetic sweep of driveway and lawn for stray nails.',
    exclusions:
      'Interior repairs of any kind.\nStructural repairs to rafters, trusses, or load-bearing components.\nGutter or downspout replacement.\nPainting, plumbing, electrical, or HVAC work.\nLandscape restoration beyond minor trampling.',
    paymentSchedule:
      '30% deposit due upon contract signing.\n50% due upon material delivery to jobsite.\n20% balance due upon substantial completion and final inspection.',
    warrantyNotes:
      "10-year workmanship warranty against installation defects.\nManufacturer materials warranty (typically 30–50 years on architectural shingles) per the shingle warranty certificate, registered in the homeowner's name within 30 days of completion.",
    termsAndConditions:
      'This proposal is valid for 30 days from the date issued. Pricing assumes work performed in a single mobilization in fair weather. Any change orders requested after work begins will be billed at our standard rates and require written authorization. Owner is responsible for any damage to landscaping not directly caused by contractor negligence. All work performed in accordance with local building codes.',
    signedByName: 'Jane Smith',
    signedByEmail: 'jane@example.com',
  });

  const sunsetProposal = buildProposal({
    companyId: KRAKEN_ID,
    number: 'PROP-2026-002',
    projectId: sunsetProject.id,
    estimateId: sunsetEstimate.estimate.id,
    total: sunsetEstimate.estimate.total,
    status: 'sent',
    proposalDate: '2026-04-20',
    expiryDate: '2026-05-20',
    scopeOfWork:
      'TPO recoat across all three buildings (approximately 38,000 sq ft total). Power-wash existing TPO surface. Make spot repairs to seams and penetrations. Install primer coat on all surfaces. Install elastomeric topcoat at manufacturer-specified mil thickness. Re-flash all roof-to-wall transitions and parapet caps.',
    inclusions:
      'All labor, materials, primer, topcoat, sealants, and equipment to complete the scope of work.\nScaffolding rental for the duration of the project.\nDaily site cleanup; debris hauled offsite weekly.\nProgress photos provided weekly.',
    exclusions:
      'Replacement of underlying TPO membrane (covered under separate proposal if needed after inspection).\nHVAC curb modifications.\nInterior leak remediation.\nAfter-hours or weekend work unless explicitly approved.',
    paymentSchedule:
      'Net-30 invoicing on monthly progress basis, billed by percent complete.\nFinal 10% retainage released upon punch-list completion and Owner sign-off.',
    warrantyNotes:
      "5-year workmanship warranty on the recoat system.\nManufacturer's 10-year material warranty when properly maintained per provided care guide.",
    termsAndConditions:
      "This proposal is valid for 30 days from the date issued. Schedule is contingent on suitable weather conditions. Owner shall provide reasonable jobsite access and a designated point of contact. Contractor maintains general liability ($2M) and workers' comp insurance; certificates available on request.",
  });

  const smithCO = buildChangeOrder(
    {
      companyId: KRAKEN_ID,
      number: 'CO-2026-001',
      projectId: smithProject.id,
      proposalId: smithProposal.id,
      status: 'approved',
      reason: 'customer_request',
      description:
        'Add ridge ventilation across both ridges. Owner-requested upgrade for improved attic airflow and shingle longevity.',
      scheduleImpactDays: 1,
      submittedAt: '2026-04-18',
      approvedAt: '2026-04-19',
      customerSignedName: 'Jane Smith',
      lines: [
        { costCode: '01-500', unit: 'ea', quantity: 1, unitCost: 1000, markupPercent: 25 },
        { costCode: '02-300', unit: 'ea', quantity: 1, unitCost: 1000, markupPercent: 25 },
      ],
    },
    krakenCodeLookup,
  );

  const sunsetCO = buildChangeOrder(
    {
      companyId: KRAKEN_ID,
      number: 'CO-2026-002',
      projectId: sunsetProject.id,
      proposalId: sunsetProposal.id,
      status: 'pending_customer',
      reason: 'conditions',
      description:
        'Additional dry-rot repair discovered on Building B north slope. Replace ~150 sq ft of decking before topcoat application.',
      scheduleImpactDays: 3,
      submittedAt: '2026-05-08',
      approvedAt: null,
      lines: [
        { costCode: '01-200', unit: 'sq ft', quantity: 150, unitCost: 5, markupPercent: 22 },
        { costCode: '02-400', unit: 'sheet', quantity: 5, unitCost: 58, markupPercent: 20 },
      ],
    },
    krakenCodeLookup,
  );

  const abcSupply = makeVendor(KRAKEN_ID, {
    name: 'ABC Roofing Supply',
    primaryContactName: 'Greg Patterson',
    email: 'orders@abcroofing.example',
    phone: '(303) 555-0301',
    addressLine1: '2400 W 38th Ave',
    city: 'Denver',
    state: 'CO',
    postalCode: '80216',
    defaultTerms: 'Net 30',
    w9OnFile: true,
  });
  const frontRangeLumber = makeVendor(KRAKEN_ID, {
    name: 'Front Range Lumber',
    primaryContactName: 'Sarah Nguyen',
    email: 'sales@frlumber.example',
    phone: '(303) 555-0410',
    addressLine1: '4920 Marshall St',
    city: 'Wheat Ridge',
    state: 'CO',
    postalCode: '80033',
    defaultTerms: 'Net 30',
    w9OnFile: true,
  });
  const mountainCrane = makeVendor(KRAKEN_ID, {
    name: 'Mountain Crane Services',
    primaryContactName: 'Pat Holland',
    email: 'dispatch@mtncrane.example',
    phone: '(720) 555-0512',
    addressLine1: '880 Indiana St',
    city: 'Lakewood',
    state: 'CO',
    postalCode: '80228',
    defaultTerms: 'Net 15',
    isSubcontractor: true,
    w9OnFile: true,
    notes:
      'Insurance certificates on file. Requires 24h notice for scheduling. Operator overtime billed in 30-min increments.',
  });

  const smithPO1 = buildPurchaseOrder(
    {
      companyId: KRAKEN_ID,
      number: 'PO-2026-001',
      projectId: smithProject.id,
      vendorId: abcSupply.id,
      status: 'issued',
      issueDate: '2026-04-10',
      expectedDeliveryDate: '2026-04-14',
      taxAmount: 352.8,
      shipping: 150,
      notes: 'Drop at jobsite. Call PM 30 min before arrival.',
      lines: [
        { costCode: '02-100', unit: 'sq', quantityOrdered: 22, quantityReceived: 0, unitCost: 145 },
        { costCode: '02-200', unit: 'sq', quantityOrdered: 22, quantityReceived: 0, unitCost: 35 },
        { costCode: '02-300', unit: 'ea', quantityOrdered: 1, quantityReceived: 0, unitCost: 450 },
      ],
    },
    krakenCodeLookup,
  );

  const smithPO2 = buildPurchaseOrder(
    {
      companyId: KRAKEN_ID,
      number: 'PO-2026-002',
      projectId: smithProject.id,
      vendorId: frontRangeLumber.id,
      status: 'partially_received',
      issueDate: '2026-04-11',
      expectedDeliveryDate: '2026-04-15',
      taxAmount: 50.32,
      shipping: 75,
      notes: 'Delivery for sheathing repairs. Partial received 2026-04-12.',
      lines: [
        { costCode: '02-400', unit: 'sheet', quantityOrdered: 12, quantityReceived: 8, unitCost: 58 },
        { costCode: '02-500', unit: 'lb', quantityOrdered: 25, quantityReceived: 25, unitCost: 2.4 },
      ],
    },
    krakenCodeLookup,
  );

  const sunsetPO = buildPurchaseOrder(
    {
      companyId: KRAKEN_ID,
      number: 'PO-2026-003',
      projectId: sunsetProject.id,
      vendorId: mountainCrane.id,
      status: 'received',
      issueDate: '2026-05-02',
      expectedDeliveryDate: '2026-05-05',
      taxAmount: 0,
      shipping: 0,
      notes: 'Two-day crane rental for material lift to Building B roof.',
      lines: [
        { costCode: '04-100', unit: 'day', quantityOrdered: 2, quantityReceived: 2, unitCost: 950 },
      ],
    },
    krakenCodeLookup,
  );

  const smithLandedCost = buildLandedCost({
    companyId: KRAKEN_ID,
    projectId: smithProject.id,
    name: 'Smith roof materials — sea freight',
    carrier: 'Tropical',
    materialCost: 4410,
    flDelivery: 150,
    crating: 200,
    freightCost: 380,
    insurance: 85,
    dutyPercent: 5,
    vatPercent: 10,
    brokerage: 180,
    portFees: 120,
    localDelivery: 95,
    quantity: 22,
    notes: '22 squares of architectural shingles + underlayment + drip edge.',
  });

  const sunsetLandedCost = buildLandedCost({
    companyId: KRAKEN_ID,
    projectId: sunsetProject.id,
    name: 'Sunset Plaza — TPO membrane shipment',
    carrier: "Pender's",
    materialCost: 25000,
    flDelivery: 800,
    crating: 1500,
    freightCost: 4200,
    insurance: 350,
    dutyPercent: 5,
    vatPercent: 10,
    brokerage: 600,
    portFees: 450,
    localDelivery: 350,
    quantity: 380,
    notes: '380 sq of TPO membrane plus primer/topcoat for Sunset Plaza recoat.',
  });

  smithPO1.po.landedCostEntryId = smithLandedCost.id;

  const smithLabor: LaborEntry[] = [
    buildLabor(
      {
        companyId: KRAKEN_ID,
        projectId: smithProject.id,
        costCode: '01-100',
        workerName: 'Mike Torres',
        workDate: '2026-04-15',
        hours: 16,
        rate: 48,
        notes: 'Tear-off crew, 2 workers × 8 hrs',
      },
      krakenCodeLookup,
    ),
    buildLabor(
      {
        companyId: KRAKEN_ID,
        projectId: smithProject.id,
        costCode: '01-200',
        workerName: 'Mike Torres',
        workDate: '2026-04-16',
        hours: 6,
        rate: 52,
      },
      krakenCodeLookup,
    ),
    buildLabor(
      {
        companyId: KRAKEN_ID,
        projectId: smithProject.id,
        costCode: '01-300',
        workerName: 'Carlos Reyes',
        workDate: '2026-04-17',
        hours: 8,
        rate: 48,
      },
      krakenCodeLookup,
    ),
    buildLabor(
      {
        companyId: KRAKEN_ID,
        projectId: smithProject.id,
        costCode: '01-400',
        workerName: 'Carlos Reyes',
        workDate: '2026-04-18',
        hours: 14,
        rate: 50,
        notes: 'Shingle install, day 1',
      },
      krakenCodeLookup,
    ),
  ];

  // ---------- TRB Ltd. seed (smaller) ----------
  const bayside = makeCustomer(TRB_ID, {
    name: 'Bayside Resorts Ltd.',
    customerType: 'commercial',
    primaryContactName: 'Marcus Bethel',
    email: 'm.bethel@bayside.example',
    phone: '(242) 555-0701',
  });

  const baysideProject = makeProject(TRB_ID, {
    customerId: bayside.id,
    number: '2026-T01',
    name: 'Bayside Beach House — cedar shake re-roof',
    status: 'estimating',
    jobsiteAddressLine1: '12 Cable Beach Cay',
    jobsiteCity: 'Nassau',
    jobsiteState: 'New Providence',
    jobsitePostalCode: 'N-7700',
    startDate: '2026-06-01',
    targetCompletionDate: '2026-07-15',
    contractValue: '0.00',
    originalContractValue: '0.00',
    totalChangeOrders: '0.00',
    currentBudget: '0.00',
  });

  const trbCostCodes: CostCode[] = [
    makeCostCode(TRB_LIBRARY_ID, { code: '01-100', description: 'Tear-Off Labor', category: 'labor' }),
    makeCostCode(TRB_LIBRARY_ID, { code: '01-200', description: 'Cedar Shake Install', category: 'labor' }),
    makeCostCode(TRB_LIBRARY_ID, { code: '02-100', description: 'Western Red Cedar Shakes', category: 'material' }),
    makeCostCode(TRB_LIBRARY_ID, { code: '02-200', description: 'Underlayment / Felt', category: 'material' }),
    makeCostCode(TRB_LIBRARY_ID, { code: '03-100', description: 'Disposal / Skip Hire', category: 'subcontract' }),
  ];
  const trbCodeLookup = new Map(trbCostCodes.map((c) => [c.code, c]));

  const pacificCedar = makeVendor(TRB_ID, {
    name: 'Pacific Cedar Imports',
    primaryContactName: 'Erin Walters',
    email: 'orders@pacificcedar.example',
    phone: '(360) 555-0822',
    addressLine1: '1500 Tacoma Way',
    city: 'Tacoma',
    state: 'WA',
    postalCode: '98421',
    defaultTerms: 'Net 30',
    w9OnFile: true,
  });

  const baysideEstimate = buildEstimateAndLines(
    TRB_ID,
    'EST-2026-T01',
    baysideProject.id,
    'draft',
    '2026-05-30',
    [
      { costCode: '01-100', unit: 'sq', quantity: 28, unitCost: 75, markupPercent: 18 },
      { costCode: '01-200', unit: 'sq', quantity: 28, unitCost: 240, markupPercent: 18 },
      { costCode: '02-100', unit: 'sq', quantity: 28, unitCost: 480, markupPercent: 12 },
      { costCode: '02-200', unit: 'sq', quantity: 28, unitCost: 38, markupPercent: 15 },
      { costCode: '03-100', unit: 'ea', quantity: 1, unitCost: 1200, markupPercent: 10 },
    ],
    trbCodeLookup,
  );

  // ---------- Combine ----------
  return {
    companies: [kraken, trb],
    customers: [acme, smith, garcia, bayside],
    projects: [smithProject, sunsetProject, garciaProject, baysideProject],
    costCodes: [...krakenCostCodes, ...trbCostCodes],
    estimates: [
      smithEstimate.estimate,
      sunsetEstimate.estimate,
      garciaEstimate.estimate,
      baysideEstimate.estimate,
    ],
    estimateLineItems: [
      ...smithEstimate.lines,
      ...sunsetEstimate.lines,
      ...garciaEstimate.lines,
      ...baysideEstimate.lines,
    ],
    proposals: [smithProposal, sunsetProposal],
    changeOrders: [smithCO.co, sunsetCO.co],
    changeOrderLineItems: [...smithCO.lines, ...sunsetCO.lines],
    vendors: [abcSupply, frontRangeLumber, mountainCrane, pacificCedar],
    purchaseOrders: [smithPO1.po, smithPO2.po, sunsetPO.po],
    purchaseOrderLines: [...smithPO1.lines, ...smithPO2.lines, ...sunsetPO.lines],
    laborEntries: smithLabor,
    jobCostEntries: [],
    landedCosts: [smithLandedCost, sunsetLandedCost],
  };
}

function getStore(): Store {
  if (!globalThis.__contractorOsMockStore) {
    globalThis.__contractorOsMockStore = seed();
  }
  return globalThis.__contractorOsMockStore;
}

// =====================================================================
// public API — companies
// =====================================================================

export function listMockCompanies(): Company[] {
  return [...getStore().companies].sort((a, b) => a.name.localeCompare(b.name));
}

export function getMockCompany(id: string): Company | undefined {
  return getStore().companies.find((c) => c.id === id);
}

export function updateMockCompany(
  id: string,
  patch: Partial<Omit<Company, 'id' | 'slug' | 'createdAt'>>,
): Company | undefined {
  const store = getStore();
  const company = store.companies.find((c) => c.id === id);
  if (!company) return undefined;
  Object.assign(company, patch, { updatedAt: new Date() });
  return company;
}

export function getCompanyLibraryId(companyId: string): string | undefined {
  return LIBRARY_BY_COMPANY[companyId];
}

// =====================================================================
// public API — companyId-scoped lookups
// =====================================================================

export function listMockCustomers(companyId: string): Customer[] {
  return getStore()
    .customers.filter((c) => c.companyId === companyId && !c.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getMockCustomer(companyId: string, id: string): Customer | undefined {
  return getStore().customers.find(
    (c) => c.id === id && c.companyId === companyId && !c.deletedAt,
  );
}

export function listMockProjects(companyId: string): Project[] {
  return getStore()
    .projects.filter((p) => p.companyId === companyId && !p.deletedAt)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function getMockProject(companyId: string, id: string): Project | undefined {
  return getStore().projects.find(
    (p) => p.id === id && p.companyId === companyId && !p.deletedAt,
  );
}

export function listMockVendors(companyId: string): Vendor[] {
  return getStore()
    .vendors.filter((v) => v.companyId === companyId && !v.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getMockVendor(companyId: string, id: string): Vendor | undefined {
  return getStore().vendors.find(
    (v) => v.id === id && v.companyId === companyId && !v.deletedAt,
  );
}

export function listMockCostCodes(companyId: string): CostCode[] {
  const libId = LIBRARY_BY_COMPANY[companyId];
  if (!libId) return [];
  return [...getStore().costCodes]
    .filter((c) => c.libraryId === libId)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function getMockCostCode(companyId: string, id: string): CostCode | undefined {
  const libId = LIBRARY_BY_COMPANY[companyId];
  return getStore().costCodes.find((c) => c.id === id && c.libraryId === libId);
}

export function listMockEstimates(companyId: string): Estimate[] {
  return [...getStore().estimates]
    .filter((e) => e.companyId === companyId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function getMockEstimate(companyId: string, id: string): Estimate | undefined {
  return getStore().estimates.find((e) => e.id === id && e.companyId === companyId);
}

export function getMockEstimateLineItems(estimateId: string): EstimateLineItem[] {
  return getStore()
    .estimateLineItems.filter((l) => l.estimateId === estimateId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function listMockProposals(companyId: string): Proposal[] {
  return [...getStore().proposals]
    .filter((p) => p.companyId === companyId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function getMockProposal(companyId: string, id: string): Proposal | undefined {
  return getStore().proposals.find((p) => p.id === id && p.companyId === companyId);
}

export function listMockChangeOrders(companyId: string): ChangeOrder[] {
  return [...getStore().changeOrders]
    .filter((c) => c.companyId === companyId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function getMockChangeOrder(
  companyId: string,
  id: string,
): ChangeOrder | undefined {
  return getStore().changeOrders.find((c) => c.id === id && c.companyId === companyId);
}

export function getMockChangeOrderLineItems(coId: string): ChangeOrderLineItem[] {
  return getStore()
    .changeOrderLineItems.filter((l) => l.changeOrderId === coId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function listChangeOrdersForProject(projectId: string): ChangeOrder[] {
  return [...getStore().changeOrders]
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function listApprovedChangeOrdersForProject(projectId: string): ChangeOrder[] {
  return getStore().changeOrders.filter(
    (c) => c.projectId === projectId && c.status === 'approved',
  );
}

export function listMockPurchaseOrders(companyId: string): PurchaseOrder[] {
  return [...getStore().purchaseOrders]
    .filter((p) => p.companyId === companyId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function getMockPurchaseOrder(
  companyId: string,
  id: string,
): PurchaseOrder | undefined {
  return getStore().purchaseOrders.find(
    (p) => p.id === id && p.companyId === companyId,
  );
}

export function getMockPurchaseOrderLines(poId: string): PurchaseOrderLine[] {
  return getStore()
    .purchaseOrderLines.filter((l) => l.purchaseOrderId === poId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function listPurchaseOrdersForProject(projectId: string): PurchaseOrder[] {
  return [...getStore().purchaseOrders]
    .filter((p) => p.projectId === projectId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function listPurchaseOrdersForVendor(vendorId: string): PurchaseOrder[] {
  return [...getStore().purchaseOrders]
    .filter((p) => p.vendorId === vendorId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function listMockLandedCosts(companyId: string): LandedCost[] {
  return [...getStore().landedCosts]
    .filter((l) => l.companyId === companyId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function getMockLandedCost(
  companyId: string,
  id: string,
): LandedCost | undefined {
  return getStore().landedCosts.find((l) => l.id === id && l.companyId === companyId);
}

export function listLandedCostsForProject(projectId: string): LandedCost[] {
  return getStore()
    .landedCosts.filter((l) => l.projectId === projectId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export type CreateLandedCostInput = {
  name: string;
  projectId: string;
  vendorId: string | null;
  purchaseOrderId: string | null;
  carrier: string;
  itemDescription: string | null;
  tariffCode: string | null;
  quantity: string;
  unitCost: string;
  materialCost: string;
  flDelivery: string;
  crating: string;
  freightCost: string;
  insurance: string;
  dutyPercent: string;
  vatPercent: string;
  envLevyPercent: string;
  excisePercent: string;
  brokerage: string;
  portFees: string;
  localDelivery: string;
  fob: string;
  cif: string;
  dutyAmount: string;
  exciseAmount: string;
  envLevyAmount: string;
  vatAmount: string;
  totalLandedCost: string;
  perUnitCost: string;
  notes: string | null;
};

export function createMockLandedCost(
  companyId: string,
  input: CreateLandedCostInput,
): LandedCost {
  const store = getStore();
  const now = new Date();
  const lc: LandedCost = {
    id: randomUUID(),
    companyId,
    projectId: input.projectId,
    vendorId: input.vendorId,
    name: input.name,
    carrier: input.carrier,
    itemDescription: input.itemDescription,
    tariffCode: input.tariffCode,
    unitCost: input.unitCost,
    materialCost: input.materialCost,
    flDelivery: input.flDelivery,
    crating: input.crating,
    freightCost: input.freightCost,
    insurance: input.insurance,
    dutyPercent: input.dutyPercent,
    vatPercent: input.vatPercent,
    envLevyPercent: input.envLevyPercent,
    envLevyAmount: input.envLevyAmount,
    excisePercent: input.excisePercent,
    exciseAmount: input.exciseAmount,
    brokerage: input.brokerage,
    portFees: input.portFees,
    localDelivery: input.localDelivery,
    quantity: input.quantity,
    fob: input.fob,
    cif: input.cif,
    dutyAmount: input.dutyAmount,
    vatAmount: input.vatAmount,
    totalLandedCost: input.totalLandedCost,
    perUnitCost: input.perUnitCost,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  store.landedCosts.push(lc);

  // If a PO was selected, also wire the PO's landedCostEntryId pointer.
  if (input.purchaseOrderId) {
    const po = store.purchaseOrders.find(
      (p) => p.id === input.purchaseOrderId && p.companyId === companyId,
    );
    if (po) {
      po.landedCostEntryId = lc.id;
      po.updatedAt = new Date();
    }
  }

  return lc;
}

export function findPurchaseOrderForLandedCost(landedCostId: string) {
  return getStore().purchaseOrders.find((p) => p.landedCostEntryId === landedCostId);
}

export function listEstimatesForProject(projectId: string): Estimate[] {
  return getStore()
    .estimates.filter((e) => e.projectId === projectId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function listProposalsForProject(projectId: string): Proposal[] {
  return getStore()
    .proposals.filter((p) => p.projectId === projectId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function listLaborEntriesForProject(projectId: string): LaborEntry[] {
  return getStore()
    .laborEntries.filter((e) => e.projectId === projectId)
    .sort((a, b) => a.workDate.localeCompare(b.workDate));
}

export function listJobCostEntriesForProject(projectId: string): JobCostEntry[] {
  return getStore()
    .jobCostEntries.filter((e) => e.projectId === projectId)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

// =====================================================================
// public API — create
// =====================================================================

export class DuplicateProjectNumberError extends Error {
  constructor() {
    super('Project number already used');
    this.name = 'DuplicateProjectNumberError';
  }
}

export class DuplicateEstimateNumberError extends Error {
  constructor() {
    super('Estimate number already used');
    this.name = 'DuplicateEstimateNumberError';
  }
}

export class DuplicateProposalNumberError extends Error {
  constructor() {
    super('Proposal number already used');
    this.name = 'DuplicateProposalNumberError';
  }
}

export class DuplicateChangeOrderNumberError extends Error {
  constructor() {
    super('Change order number already used');
    this.name = 'DuplicateChangeOrderNumberError';
  }
}

export class DuplicatePONumberError extends Error {
  constructor() {
    super('PO number already used');
    this.name = 'DuplicatePONumberError';
  }
}

export class DuplicateCostCodeError extends Error {
  constructor() {
    super('Cost code already exists');
    this.name = 'DuplicateCostCodeError';
  }
}

export function createMockCustomer(
  companyId: string,
  input: Omit<Customer, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
): Customer {
  const store = getStore();
  const now = new Date();
  const customer: Customer = {
    id: randomUUID(),
    companyId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.customers.push(customer);
  return customer;
}

export type CreateVendorInput = Omit<
  Vendor,
  'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export function createMockVendor(companyId: string, input: CreateVendorInput): Vendor {
  const store = getStore();
  const now = new Date();
  const vendor: Vendor = {
    id: randomUUID(),
    companyId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.vendors.push(vendor);
  return vendor;
}

export function createMockProject(
  companyId: string,
  input: Omit<Project, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
): Project {
  const store = getStore();
  if (
    store.projects.some(
      (p) =>
        p.number === input.number && p.companyId === companyId && !p.deletedAt,
    )
  ) {
    throw new DuplicateProjectNumberError();
  }
  const now = new Date();
  const project: Project = {
    id: randomUUID(),
    companyId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.projects.push(project);
  return project;
}

export function createMockCostCode(
  companyId: string,
  input: Pick<CostCode, 'code' | 'description' | 'category'>,
): CostCode {
  const store = getStore();
  const libraryId = LIBRARY_BY_COMPANY[companyId];
  if (!libraryId) throw new Error('No cost code library for company');
  if (store.costCodes.some((c) => c.code === input.code && c.libraryId === libraryId)) {
    throw new DuplicateCostCodeError();
  }
  const now = new Date();
  const code: CostCode = {
    id: randomUUID(),
    libraryId,
    code: input.code,
    description: input.description,
    category: input.category,
    createdAt: now,
    updatedAt: now,
  };
  store.costCodes.push(code);
  return code;
}

export type CreateEstimateInput = {
  number: string;
  projectId: string;
  status: Estimate['status'];
  validUntil: string | null;
  lines: Array<{
    costCodeId: string;
    description: string;
    unit: string | null;
    quantity: string;
    unitCost: string;
    markupPercent: string;
    lineTotal: string;
  }>;
  subtotal: string;
  total: string;
};

export function createMockEstimate(
  companyId: string,
  input: CreateEstimateInput,
): Estimate {
  const store = getStore();
  if (store.estimates.some((e) => e.number === input.number && e.companyId === companyId)) {
    throw new DuplicateEstimateNumberError();
  }
  const now = new Date();
  const estimateId = randomUUID();

  const estimate: Estimate = {
    id: estimateId,
    companyId,
    projectId: input.projectId,
    number: input.number,
    version: 1,
    status: input.status,
    subtotal: input.subtotal,
    taxAmount: '0.00',
    total: input.total,
    markupPercent: '0.000',
    overheadPercent: '0.000',
    validUntil: input.validUntil,
    sentAt:
      input.status === 'sent' || input.status === 'approved' || input.status === 'rejected'
        ? now
        : null,
    approvedAt: input.status === 'approved' ? now : null,
    parentEstimateId: null,
    createdAt: now,
    updatedAt: now,
  };
  store.estimates.push(estimate);

  input.lines.forEach((l, i) => {
    store.estimateLineItems.push({
      id: randomUUID(),
      estimateId,
      sectionId: null,
      costCodeId: l.costCodeId,
      assemblyId: null,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
      markupPercent: l.markupPercent,
      lineTotal: l.lineTotal,
      sortOrder: i,
    });
  });

  return estimate;
}

export type CreateProposalInput = {
  number: string;
  projectId: string;
  estimateId: string;
  total: string;
  status: Proposal['status'];
  proposalDate: string | null;
  expiryDate: string | null;
  scopeOfWork: string | null;
  inclusions: string | null;
  exclusions: string | null;
  paymentSchedule: string | null;
  warrantyNotes: string | null;
  termsAndConditions: string | null;
};

export function createMockProposal(
  companyId: string,
  input: CreateProposalInput,
): Proposal {
  const store = getStore();
  if (store.proposals.some((p) => p.number === input.number && p.companyId === companyId)) {
    throw new DuplicateProposalNumberError();
  }
  const now = new Date();
  const proposal: Proposal = {
    id: randomUUID(),
    companyId,
    projectId: input.projectId,
    estimateId: input.estimateId,
    templateId: null,
    number: input.number,
    version: 1,
    status: input.status,
    proposalDate: input.proposalDate,
    expiryDate: input.expiryDate,
    total: input.total,
    scopeOfWork: input.scopeOfWork,
    inclusions: input.inclusions,
    exclusions: input.exclusions,
    paymentSchedule: input.paymentSchedule,
    warrantyNotes: input.warrantyNotes,
    termsAndConditions: input.termsAndConditions,
    pdfUrl: null,
    publicToken: null,
    sentAt:
      input.status !== 'draft' && input.status !== 'expired' ? now : null,
    viewedAt:
      input.status === 'viewed' ||
      input.status === 'accepted' ||
      input.status === 'declined'
        ? now
        : null,
    acceptedAt: input.status === 'accepted' ? now : null,
    declinedAt: input.status === 'declined' ? now : null,
    signatureImageUrl: null,
    signedByName: null,
    signedByEmail: null,
    signedIp: null,
    createdAt: now,
    updatedAt: now,
  };
  store.proposals.push(proposal);
  return proposal;
}

export type CreateChangeOrderInput = {
  number: string;
  projectId: string;
  proposalId: string | null;
  status: ChangeOrder['status'];
  reason: ChangeOrder['reason'];
  description: string;
  scheduleImpactDays: number;
  submittedAt: string | null;
  approvedAt: string | null;
  customerSignedName: string | null;
  subtotal: string;
  total: string;
  lines: Array<{
    costCodeId: string;
    description: string;
    unit: string | null;
    quantity: string;
    unitCost: string;
    markupPercent: string;
    lineTotal: string;
  }>;
};

export function createMockChangeOrder(
  companyId: string,
  input: CreateChangeOrderInput,
): ChangeOrder {
  const store = getStore();
  if (
    store.changeOrders.some(
      (c) => c.number === input.number && c.companyId === companyId,
    )
  ) {
    throw new DuplicateChangeOrderNumberError();
  }
  const now = new Date();
  const coId = randomUUID();

  const co: ChangeOrder = {
    id: coId,
    companyId,
    projectId: input.projectId,
    proposalId: input.proposalId,
    number: input.number,
    status: input.status,
    reason: input.reason,
    description: input.description,
    subtotal: input.subtotal,
    taxAmount: '0.00',
    total: input.total,
    scheduleImpactDays: input.scheduleImpactDays,
    publicToken: null,
    submittedAt: input.submittedAt,
    sentAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
    customerSignedAt: input.status === 'approved' ? now : null,
    customerSignedName: input.customerSignedName,
    customerSignedIp: null,
    approvedAt: input.approvedAt,
    rejectedAt: input.status === 'rejected' ? now.toISOString().slice(0, 10) : null,
    createdAt: now,
    updatedAt: now,
  };
  store.changeOrders.push(co);

  input.lines.forEach((l, i) => {
    store.changeOrderLineItems.push({
      id: randomUUID(),
      changeOrderId: coId,
      costCodeId: l.costCodeId,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
      markupPercent: l.markupPercent,
      lineTotal: l.lineTotal,
      sortOrder: i,
    });
  });

  if (input.status === 'approved') {
    applyApprovedCOToProject(store, input.projectId, Number(input.total));
  }

  return co;
}

function applyApprovedCOToProject(store: Store, projectId: string, amount: number) {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return;
  const newCO = Number(project.totalChangeOrders) + amount;
  const newContract = Number(project.contractValue) + amount;
  project.totalChangeOrders = newCO.toFixed(2);
  project.contractValue = newContract.toFixed(2);
  project.updatedAt = new Date();
}

export type CreatePurchaseOrderInput = {
  number: string;
  projectId: string;
  vendorId: string;
  landedCostEntryId: string | null;
  status: PurchaseOrder['status'];
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  subtotal: string;
  taxAmount: string;
  shipping: string;
  total: string;
  lines: Array<{
    costCodeId: string;
    description: string;
    unit: string | null;
    quantityOrdered: string;
    unitCost: string;
    lineTotal: string;
  }>;
};

export function createMockPurchaseOrder(
  companyId: string,
  input: CreatePurchaseOrderInput,
): PurchaseOrder {
  const store = getStore();
  if (
    store.purchaseOrders.some(
      (p) => p.number === input.number && p.companyId === companyId,
    )
  ) {
    throw new DuplicatePONumberError();
  }
  const now = new Date();
  const poId = randomUUID();

  const po: PurchaseOrder = {
    id: poId,
    companyId,
    projectId: input.projectId,
    vendorId: input.vendorId,
    landedCostEntryId: input.landedCostEntryId,
    number: input.number,
    status: input.status,
    issueDate: input.issueDate,
    expectedDeliveryDate: input.expectedDeliveryDate,
    shipToAddressLine1: null,
    shipToCity: null,
    shipToState: null,
    shipToPostalCode: null,
    subtotal: input.subtotal,
    taxAmount: input.taxAmount,
    shipping: input.shipping,
    total: input.total,
    notes: input.notes,
    issuedAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
    closedAt: input.status === 'closed' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  store.purchaseOrders.push(po);

  input.lines.forEach((l, i) => {
    store.purchaseOrderLines.push({
      id: randomUUID(),
      purchaseOrderId: poId,
      costCodeId: l.costCodeId,
      description: l.description,
      unit: l.unit,
      quantityOrdered: l.quantityOrdered,
      quantityReceived: '0.0000',
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
      sortOrder: i,
    });
  });

  return po;
}
