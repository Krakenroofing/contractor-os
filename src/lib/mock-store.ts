import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  DEFAULT_COST_CODES,
  GLOBAL_COST_CODE_LIBRARY_ID,
} from '@/lib/data/cost-code-defaults';
import type {
  ActivityLogEntry,
  ChangeOrder,
  ChangeOrderLineItem,
  Company,
  CostCode,
  Customer,
  Employee,
  PayPeriod,
  TimeEntry,
  PaystubAdjustment,
  PeriodPayOverride,
  PeriodPaystubSnapshot,
  SubcontractorPayment,
  Estimate,
  EstimateLineItem,
  Invoice,
  InvoiceLineItem,
  InvoicePayment,
  InvoiceTemplate,
  JobCostEntry,
  LaborEntry,
  LandedCost,
  Project,
  Proposal,
  PurchaseOrder,
  PurchaseOrderLine,
  RetainageRelease,
  Vendor,
} from '@/db/schema';

// Stable IDs so cookies / cross-references survive HMR.
export const KRAKEN_ID = '00000000-0000-0000-0000-000000000001';
export const TRB_ID = '00000000-0000-0000-0000-000000000002';
export const KRAKEN_LIBRARY_ID = '00000000-0000-0000-0000-000000000010';
export const TRB_LIBRARY_ID = '00000000-0000-0000-0000-000000000011';

// Re-exported here so call-sites can import the constant without reaching
// into @/lib/data/cost-code-defaults directly.
export { GLOBAL_COST_CODE_LIBRARY_ID };

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
  employees: Employee[];
  payPeriods: PayPeriod[];
  timeEntries: TimeEntry[];
  periodPayOverrides: PeriodPayOverride[];
  periodPaystubSnapshots: PeriodPaystubSnapshot[];
  paystubAdjustments: PaystubAdjustment[];
  subcontractorPayments: SubcontractorPayment[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  laborEntries: LaborEntry[];
  jobCostEntries: JobCostEntry[];
  landedCosts: LandedCost[];
  invoiceTemplates: InvoiceTemplate[];
  invoices: Invoice[];
  invoiceLineItems: InvoiceLineItem[];
  invoicePayments: InvoicePayment[];
  retainageReleases: RetainageRelease[];
  activityLog: ActivityLogEntry[];
};

declare global {
  // Persist mock store across HMR reloads in dev.
  var __contractorOsMockStore: Store | undefined;
}

// =====================================================================
// builders
// =====================================================================
//
// MARKER: dup-keys-fix-2026-05-05
// If this comment is missing from your deployed source, the deployed branch
// is older than the local fix. Builders below previously specified id/name/
// slug/customerId both explicitly and via `...over`, which is a duplicate-key
// error under strict TS / ESLint. The fix is to drop the explicit lines and
// let `...over` (constrained by Pick<>) provide them.

function makeCompany(over: Partial<Company> & Pick<Company, 'id' | 'name' | 'slug'>): Company {
  const now = new Date();
  // Defaults first, then spread `over` to apply caller overrides. Because
  // `over` carries the required id/name/slug via Pick<>, the result is a
  // complete `Company` row.
  return {
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
    // Phase 1 banking / TIN fields — null in mock data.
    tinNumber: null,
    bankName: null,
    bankBranch: null,
    bankAccountName: null,
    bankAccountNumber: null,
    bankAddress: null,
    paymentNotes: null,
    // Banking & Receipts — Phase 1 mock defaults. Real companies pick
    // `isVatActive`/`vatJurisdiction` via the SQL backfill in
    // 2026-05-15_banking_phase1; the mock store mirrors that for parity
    // with the typed Company shape.
    isVatActive: false,
    vatJurisdiction: null,
    accountingMethod: 'accrual' as const,
    // Phase M6.3: per-company opt-in for auto-posting clock sessions.
    autoPostClockSessions: false,
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
    primaryContactName: null,
    email: null,
    phone: null,
    customerType: 'residential',
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingCity: null,
    billingState: null,
    billingPostalCode: null,
    tinNumber: null,
    notes: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeProject(
  companyId: string,
  over: Partial<Project> & Pick<Project, 'customerId' | 'name'>,
): Project {
  const now = new Date();
  return {
    id: randomUUID(),
    companyId,
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
    reconciliationVerifiedAt: null,
    reconciliationVerifiedRole: null,
    reconciliationVerifiedNote: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeCostCode(
  libraryId: string,
  over: Pick<CostCode, 'code' | 'description' | 'category'> &
    Partial<
      Pick<
        CostCode,
        'division' | 'parentId' | 'isActive' | 'sortOrder' | 'notes' | 'defaultCost'
      >
    >,
): CostCode {
  const now = new Date();
  return {
    id: randomUUID(),
    libraryId,
    code: over.code,
    description: over.description,
    category: over.category,
    division: over.division ?? null,
    parentId: over.parentId ?? null,
    isActive: over.isActive ?? true,
    sortOrder: over.sortOrder ?? 0,
    notes: over.notes ?? null,
    defaultCost: over.defaultCost ?? null,
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
    // Vendor Defaults — Phase 1 mock defaults. Null in demo data.
    defaultCostCodeId: null,
    defaultCostType: null,
    defaultAccountingAccountId: null,
    vatRatePercent: null,
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
      inventoryItemId: null,
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
    submittedAt: input.status !== 'draft' ? now : null,
    sentAt: input.status !== 'draft' ? now : null,
    viewedAt:
      input.status === 'viewed' ||
      input.status === 'accepted' ||
      input.status === 'approved' ||
      input.status === 'declined' ||
      input.status === 'rejected'
        ? now
        : null,
    approvedAt:
      input.status === 'approved' || input.status === 'accepted' ? now : null,
    rejectedAt:
      input.status === 'rejected' || input.status === 'declined' ? now : null,
    acceptedAt:
      input.status === 'approved' || input.status === 'accepted' ? now : null,
    declinedAt:
      input.status === 'rejected' || input.status === 'declined' ? now : null,
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
      inventoryItemId: null,
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
    submittedAt:
      status === 'internal_review' ||
      status === 'sent' ||
      status === 'approved' ||
      status === 'rejected'
        ? now
        : null,
    sentAt: status === 'sent' || status === 'approved' || status === 'rejected' ? now : null,
    approvedAt: status === 'approved' ? now : null,
    rejectedAt: status === 'rejected' ? now : null,
    parentEstimateId: null,
    createdAt: now,
    updatedAt: now,
  };

  return { estimate, lines };
}

// =====================================================================
// seed
// =====================================================================

// =====================================================================
// Invoice template + invoice seed helpers
// =====================================================================

type SeedInvoiceTemplate = Partial<InvoiceTemplate> &
  Pick<InvoiceTemplate, 'companyId' | 'name'>;

function buildInvoiceTemplate(over: SeedInvoiceTemplate): InvoiceTemplate {
  const now = new Date();
  return {
    id: randomUUID(),
    description: null,
    isDefault: false,
    showCompanyBranding: true,
    showHeader: true,
    showLineItems: true,
    showPaymentTerms: true,
    showRetainage: false,
    showTaxVat: true,
    showNotes: true,
    showSignature: true,
    showFooter: true,
    headerLayout: 'standard',
    lineItemLayout: 'detailed',
    headerNote: null,
    paymentTermsText: null,
    retainageText: null,
    notesText: null,
    footerText: null,
    // Phase 1 additions
    titleOverride: null,
    tinLabel: 'TIN',
    issuedByLabel: 'Issued by',
    showBillToTin: false,
    billToAttentionLabel: 'Attention',
    showProjectMetadata: true,
    poNumberLabel: 'Purchase Order',
    billingNumberLabel: 'Billing #',
    projectDescriptionLabel: 'Project description',
    showWireInstructions: false,
    wireInstructionsNote: null,
    showQualifications: false,
    qualificationsText: null,
    showAccountHistory: false,
    accountHistoryLabel: 'Account history',
    showProgressBilling: false,
    progressBillingLabel: 'Progress billing',
    contractValueLabel: 'Total contract value',
    changeOrdersLabel: 'Approved change orders',
    priorBilledLabel: 'Less previously billed',
    retainageHeldLabel: 'Less retainage',
    vatLabel: 'VAT',
    vatRatePercent: '0',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function seedInvoiceTemplatesForCompany(companyId: string): InvoiceTemplate[] {
  return [
    buildInvoiceTemplate({
      companyId,
      name: 'Standard Progress Invoice',
      description:
        'All sections visible. Most common contractor billing template.',
      isDefault: true,
      showRetainage: true,
      paymentTermsText:
        'Net 15 from invoice date. Late payments accrue 1.5% per month.',
      footerText: 'Thank you for your business.',
    }),
    buildInvoiceTemplate({
      companyId,
      name: 'Deposit Invoice',
      description: 'Single lump-sum line. Used for upfront deposits.',
      lineItemLayout: 'lumpsum',
      showRetainage: false,
      showLineItems: true,
      paymentTermsText:
        'Deposit due upon contract signing. Work begins on receipt.',
      headerNote: 'Deposit invoice — work has not yet commenced.',
    }),
    buildInvoiceTemplate({
      companyId,
      name: 'Retainage Billing',
      description:
        'Final retainage release. Emphasizes retainage block, hides line items.',
      showRetainage: true,
      showLineItems: false,
      lineItemLayout: 'summary',
      retainageText:
        'Final retainage released following punch-list completion and Owner sign-off.',
      paymentTermsText: 'Net 30 from invoice date.',
    }),
    buildInvoiceTemplate({
      companyId,
      name: 'Change Order Invoice',
      description: 'Focused on change-order line items only.',
      lineItemLayout: 'detailed',
      showRetainage: false,
      headerNote:
        'Change order billing — references the approved CO attached to this project.',
    }),
    buildInvoiceTemplate({
      companyId,
      name: 'Partner Transparent Cost Breakdown',
      description:
        'Open-book partner billing. All line items, costs, and overhead visible.',
      lineItemLayout: 'detailed',
      showRetainage: true,
      headerLayout: 'detailed',
      paymentTermsText:
        'Net 15. Open-book — supporting documentation provided on request.',
      notesText:
        'Cost breakdown reflects actual costs incurred plus agreed-upon overhead.',
    }),
    buildInvoiceTemplate({
      companyId,
      name: 'Simple Lump Sum Invoice',
      description: 'Minimal layout. Single total, no line-item detail.',
      lineItemLayout: 'lumpsum',
      showLineItems: true,
      showRetainage: false,
      showNotes: false,
      headerLayout: 'compact',
    }),
  ];
}

type SeedInvoiceLine = {
  costCodeId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  unitCost: number;
};

type SeedInvoice = {
  companyId: string;
  number: string;
  projectId: string;
  proposalId?: string | null;
  changeOrderId?: string | null;
  templateId?: string | null;
  status: Invoice['status'];
  billingType: Invoice['billingType'];
  invoiceDate: string;
  dueDate: string | null;
  taxAmount: number;
  retainagePercent?: number;
  retainageAmount: number;
  retainageReleased?: number;
  expectedRetainageReleaseDate?: string | null;
  amountPaid: number;
  notes?: string | null;
  termsOverride?: string | null;
  lines: SeedInvoiceLine[];
  payments?: {
    paymentNumber: string;
    paidDate: string;
    amount: number;
    method: string;
    reference?: string;
    bankAccount?: string;
    status?: 'pending' | 'received' | 'applied' | 'returned';
  }[];
  retainageReleases?: {
    releaseNumber: string;
    releaseDate: string;
    amount: number;
    paymentId?: string | null;
    notes?: string | null;
  }[];
};

function buildInvoice(input: SeedInvoice): {
  invoice: Invoice;
  lines: InvoiceLineItem[];
  payments: InvoicePayment[];
  retainageReleases: RetainageRelease[];
} {
  const now = new Date();
  const invoiceId = randomUUID();
  let subtotal = 0;
  const lines: InvoiceLineItem[] = input.lines.map((sl, i) => {
    const lineTotal = sl.quantity * sl.unitCost;
    subtotal += lineTotal;
    return {
      id: randomUUID(),
      invoiceId,
      costCodeId: sl.costCodeId ?? null,
      inventoryItemId: null,
      description: sl.description,
      unit: sl.unit ?? null,
      quantity: sl.quantity.toFixed(4),
      unitCost: sl.unitCost.toFixed(4),
      lineTotal: lineTotal.toFixed(2),
      sortOrder: i,
    };
  });
  const total = subtotal + input.taxAmount - input.retainageAmount;
  // Auto-derive retainage % from held / subtotal when not explicitly provided.
  const derivedPct =
    input.retainagePercent ??
    (subtotal > 0 ? (input.retainageAmount / subtotal) * 100 : 0);
  const invoice: Invoice = {
    id: invoiceId,
    companyId: input.companyId,
    projectId: input.projectId,
    accountingAccountId: null,
    proposalId: input.proposalId ?? null,
    changeOrderId: input.changeOrderId ?? null,
    templateId: input.templateId ?? null,
    number: input.number,
    status: input.status,
    billingType: input.billingType,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    subtotal: subtotal.toFixed(2),
    taxAmount: input.taxAmount.toFixed(2),
    retainagePercent: derivedPct.toFixed(3),
    retainageAmount: input.retainageAmount.toFixed(2),
    retainageReleased: (input.retainageReleased ?? 0).toFixed(2),
    expectedRetainageReleaseDate: input.expectedRetainageReleaseDate ?? null,
    total: total.toFixed(2),
    amountPaid: input.amountPaid.toFixed(2),
    notes: input.notes ?? null,
    termsOverride: input.termsOverride ?? null,
    // Phase 1 additions — null in seed data; populated by users on edit.
    billingLabel: null,
    purchaseOrderNumber: null,
    percentOfContract: null,
    sentAt: input.status !== 'draft' && input.status !== 'void' ? now : null,
    paidAt: input.status === 'paid' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  const payments: InvoicePayment[] =
    input.payments?.map((p) => ({
      id: randomUUID(),
      invoiceId,
      paymentNumber: p.paymentNumber,
      paidDate: p.paidDate,
      amount: p.amount.toFixed(2),
      method: p.method ?? null,
      reference: p.reference ?? null,
      bankAccount: p.bankAccount ?? null,
      status: p.status ?? 'received',
      notes: null,
      createdAt: now,
    })) ?? [];
  const retainageReleases: RetainageRelease[] =
    input.retainageReleases?.map((r) => ({
      id: randomUUID(),
      companyId: input.companyId,
      invoiceId,
      projectId: input.projectId,
      paymentId: r.paymentId ?? null,
      releaseNumber: r.releaseNumber,
      releaseDate: r.releaseDate,
      amount: r.amount.toFixed(2),
      notes: r.notes ?? null,
      createdAt: now,
    })) ?? [];
  return { invoice, lines, payments, retainageReleases };
}

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
    'internal_review',
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
    status: 'approved',
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
      status: 'submitted',
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

  // Global library — same DEFAULT_COST_CODES that the SQL migration seeds. In
  // demo mode we read these into the in-memory store so the listing UI shows
  // the same divisions/codes the production schema would.
  const globalCostCodes: CostCode[] = DEFAULT_COST_CODES.map((d) =>
    makeCostCode(GLOBAL_COST_CODE_LIBRARY_ID, {
      code: d.code,
      description: d.description,
      category: d.category,
      division: d.division,
      sortOrder: d.sortOrder,
      isActive: true,
    }),
  );

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

  // ---------- Invoice templates + demo invoices ----------
  const krakenTemplates = seedInvoiceTemplatesForCompany(KRAKEN_ID);
  const trbTemplates = seedInvoiceTemplatesForCompany(TRB_ID);
  const krakenStandardTpl = krakenTemplates.find((t) => t.name === 'Standard Progress Invoice')!;
  const krakenDepositTpl = krakenTemplates.find((t) => t.name === 'Deposit Invoice')!;
  const krakenCOTpl = krakenTemplates.find((t) => t.name === 'Change Order Invoice')!;
  const trbDepositTpl = trbTemplates.find((t) => t.name === 'Deposit Invoice')!;

  const smithProgressInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-001',
    projectId: smithProject.id,
    proposalId: smithProposal.id,
    templateId: krakenStandardTpl.id,
    status: 'partial',
    billingType: 'progress',
    invoiceDate: '2026-04-20',
    dueDate: '2026-05-05',
    taxAmount: 0,
    retainagePercent: 10,
    retainageAmount: 1425,
    retainageReleased: 0,
    expectedRetainageReleaseDate: '2026-06-10',
    amountPaid: 8000,
    notes: 'Progress billing #1 — 50% milestone after tear-off & decking complete.',
    lines: [
      {
        description: 'Progress billing — Smith roof (50% milestone)',
        unit: 'lot',
        quantity: 1,
        unitCost: 14250,
      },
    ],
    payments: [
      {
        paymentNumber: 'PAY-2026-001',
        paidDate: '2026-04-22',
        amount: 8000,
        method: 'wire',
        reference: 'WT-44218',
        bankAccount: 'Operating — Wells Fargo ••4218',
        status: 'applied',
      },
    ],
  });

  const smithCOInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-002',
    projectId: smithProject.id,
    proposalId: smithProposal.id,
    changeOrderId: smithCO.co.id,
    templateId: krakenCOTpl.id,
    status: 'paid',
    billingType: 'change_order',
    invoiceDate: '2026-04-25',
    dueDate: '2026-05-10',
    taxAmount: 0,
    retainageAmount: 0,
    amountPaid: 2500,
    notes: 'Approved CO-2026-001: ridge ventilation upgrade.',
    lines: [
      {
        description: 'CO-2026-001 — Ridge ventilation, labor + material',
        unit: 'lot',
        quantity: 1,
        unitCost: 2500,
      },
    ],
    payments: [
      {
        paymentNumber: 'PAY-2026-002',
        paidDate: '2026-04-30',
        amount: 2500,
        method: 'check',
        reference: '#1042',
        bankAccount: 'Operating — Wells Fargo ••4218',
        status: 'applied',
      },
    ],
  });

  const sunsetDepositInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-003',
    projectId: sunsetProject.id,
    proposalId: sunsetProposal.id,
    templateId: krakenDepositTpl.id,
    status: 'sent',
    billingType: 'deposit',
    invoiceDate: '2026-05-01',
    dueDate: '2026-05-15',
    taxAmount: 0,
    retainageAmount: 0,
    amountPaid: 0,
    notes: '25% deposit due upon contract signing.',
    lines: [
      {
        description: '25% mobilization deposit — Sunset Plaza TPO recoat',
        unit: 'lot',
        quantity: 1,
        unitCost: 35500,
      },
    ],
  });

  const baysideDepositInv = buildInvoice({
    companyId: TRB_ID,
    number: 'INV-2026-T01',
    projectId: baysideProject.id,
    templateId: trbDepositTpl.id,
    status: 'draft',
    billingType: 'deposit',
    invoiceDate: '2026-05-15',
    dueDate: '2026-05-30',
    taxAmount: 0,
    retainageAmount: 0,
    amountPaid: 0,
    notes: '25% deposit on signed contract for Bayside cedar shake re-roof.',
    lines: [
      {
        description: '25% deposit — Bayside Beach House cedar shake re-roof',
        unit: 'lot',
        quantity: 1,
        unitCost: 11250,
      },
    ],
  });

  // Aging-spread invoices so AR demo shows every bucket.
  const smithLateInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-004',
    projectId: smithProject.id,
    proposalId: smithProposal.id,
    templateId: krakenStandardTpl.id,
    status: 'sent',
    billingType: 'progress',
    invoiceDate: '2026-03-15',
    dueDate: '2026-04-01',
    taxAmount: 0,
    retainageAmount: 0,
    amountPaid: 0,
    notes: 'Supplemental sheathing & flashing labor.',
    lines: [
      { description: 'Sheathing repair — supplemental', unit: 'lot', quantity: 1, unitCost: 5000 },
    ],
  });

  const sunsetMidLateInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-005',
    projectId: sunsetProject.id,
    proposalId: sunsetProposal.id,
    templateId: krakenStandardTpl.id,
    status: 'sent',
    billingType: 'milestone',
    invoiceDate: '2026-02-10',
    dueDate: '2026-03-01',
    taxAmount: 0,
    retainageAmount: 0,
    amountPaid: 0,
    notes: 'Building A milestone: tear-off + primer complete.',
    lines: [
      { description: 'Building A — tear-off + primer milestone', unit: 'lot', quantity: 1, unitCost: 7500 },
    ],
  });

  const garciaLateInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-006',
    projectId: garciaProject.id,
    templateId: krakenStandardTpl.id,
    status: 'sent',
    billingType: 'progress',
    invoiceDate: '2026-01-25',
    dueDate: '2026-02-15',
    taxAmount: 0,
    retainageAmount: 0,
    amountPaid: 0,
    notes: 'Pre-construction & design fees.',
    lines: [
      { description: 'Pre-construction & design fees', unit: 'lot', quantity: 1, unitCost: 3200 },
    ],
  });

  const baysideOldInv = buildInvoice({
    companyId: TRB_ID,
    number: 'INV-2026-T02',
    projectId: baysideProject.id,
    templateId: trbDepositTpl.id,
    status: 'sent',
    billingType: 'deposit',
    invoiceDate: '2025-11-20',
    dueDate: '2025-12-15',
    taxAmount: 0,
    retainageAmount: 0,
    amountPaid: 0,
    notes: 'Initial planning retainer (long overdue).',
    lines: [
      { description: 'Initial planning retainer', unit: 'lot', quantity: 1, unitCost: 2000 },
    ],
  });

  // ---------- Retainage demo invoices ----------
  // Sunset Plaza Building A milestone invoice — fully PAID but with $750
  // retainage still held; one partial release of $300 already made. This drives
  // the "partially_released" status in the Retainage dashboard.
  const sunsetRetentionInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-007',
    projectId: sunsetProject.id,
    proposalId: sunsetProposal.id,
    templateId: krakenStandardTpl.id,
    status: 'paid',
    billingType: 'milestone',
    invoiceDate: '2026-03-25',
    dueDate: '2026-04-15',
    taxAmount: 0,
    retainagePercent: 10,
    retainageAmount: 750,
    retainageReleased: 300,
    expectedRetainageReleaseDate: '2026-07-15',
    amountPaid: 6750,
    notes: 'Building A milestone — primer + topcoat complete. Retainage 10%.',
    lines: [
      {
        description: 'Building A — primer + topcoat milestone',
        unit: 'lot',
        quantity: 1,
        unitCost: 7500,
      },
    ],
    payments: [
      {
        paymentNumber: 'PAY-2026-003',
        paidDate: '2026-04-12',
        amount: 6750,
        method: 'ach',
        reference: 'ACH-77821',
        bankAccount: 'Operating — Wells Fargo ••4218',
        status: 'applied',
      },
    ],
    retainageReleases: [
      {
        releaseNumber: 'RTN-2026-001',
        releaseDate: '2026-04-25',
        amount: 300,
        notes: 'Partial retainage release — portion of Building A scope signed off.',
      },
    ],
  });

  // Older completed Smith mini-job — 5% retainage was held and has been fully
  // RELEASED. Drives the "released" status row.
  const smithReleasedInv = buildInvoice({
    companyId: KRAKEN_ID,
    number: 'INV-2026-008',
    projectId: smithProject.id,
    proposalId: smithProposal.id,
    templateId: krakenStandardTpl.id,
    status: 'paid',
    billingType: 'final',
    invoiceDate: '2026-02-15',
    dueDate: '2026-03-01',
    taxAmount: 0,
    retainagePercent: 5,
    retainageAmount: 250,
    retainageReleased: 250,
    expectedRetainageReleaseDate: '2026-04-15',
    amountPaid: 4750,
    notes:
      'Final retainage on supplemental gutter work — released after punch-list sign-off.',
    lines: [
      {
        description: 'Supplemental gutter scope (final billing)',
        unit: 'lot',
        quantity: 1,
        unitCost: 5000,
      },
    ],
    payments: [
      {
        paymentNumber: 'PAY-2026-004',
        paidDate: '2026-03-01',
        amount: 4750,
        method: 'check',
        reference: '#1019',
        bankAccount: 'Operating — Wells Fargo ••4218',
        status: 'applied',
      },
    ],
    retainageReleases: [
      {
        releaseNumber: 'RTN-2026-002',
        releaseDate: '2026-04-20',
        amount: 250,
        notes: 'Final retainage released after punch-list sign-off.',
      },
    ],
  });

  // Bayside completion invoice — paid but retainage OVERDUE (expected release
  // 2026-03-30, today is mid-2026). Drives the "overdue" retainage row.
  const baysideOverdueRetentionInv = buildInvoice({
    companyId: TRB_ID,
    number: 'INV-2026-T03',
    projectId: baysideProject.id,
    templateId: trbDepositTpl.id,
    status: 'paid',
    billingType: 'final',
    invoiceDate: '2026-01-10',
    dueDate: '2026-02-10',
    taxAmount: 0,
    retainagePercent: 10,
    retainageAmount: 1500,
    retainageReleased: 0,
    expectedRetainageReleaseDate: '2026-03-30',
    amountPaid: 13500,
    notes:
      'Substantial completion billing — 10% retainage held pending Owner sign-off.',
    lines: [
      {
        description: 'Substantial completion — Bayside Beach House',
        unit: 'lot',
        quantity: 1,
        unitCost: 15000,
      },
    ],
    payments: [
      {
        paymentNumber: 'PAY-2026-T01',
        paidDate: '2026-02-08',
        amount: 13500,
        method: 'wire',
        reference: 'WT-T-1109',
        bankAccount: 'TRB Operating — RBC ••0220',
        status: 'applied',
      },
    ],
  });

  const seededInvoices = [
    smithProgressInv,
    smithCOInv,
    sunsetDepositInv,
    baysideDepositInv,
    smithLateInv,
    sunsetMidLateInv,
    garciaLateInv,
    baysideOldInv,
    sunsetRetentionInv,
    smithReleasedInv,
    baysideOverdueRetentionInv,
  ];

  // ---------- Combine ----------
  return {
    companies: [kraken, trb],
    customers: [acme, smith, garcia, bayside],
    projects: [smithProject, sunsetProject, garciaProject, baysideProject],
    costCodes: [...krakenCostCodes, ...trbCostCodes, ...globalCostCodes],
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
    employees: [],
    payPeriods: [],
    timeEntries: [],
    periodPayOverrides: [],
    periodPaystubSnapshots: [],
    paystubAdjustments: [],
    subcontractorPayments: [],
    purchaseOrders: [smithPO1.po, smithPO2.po, sunsetPO.po],
    purchaseOrderLines: [...smithPO1.lines, ...smithPO2.lines, ...sunsetPO.lines],
    laborEntries: smithLabor,
    jobCostEntries: [],
    landedCosts: [smithLandedCost, sunsetLandedCost],
    invoiceTemplates: [...krakenTemplates, ...trbTemplates],
    invoices: seededInvoices.map((s) => s.invoice),
    invoiceLineItems: seededInvoices.flatMap((s) => s.lines),
    invoicePayments: seededInvoices.flatMap((s) => s.payments),
    retainageReleases: seededInvoices.flatMap((s) => s.retainageReleases),
    activityLog: [],
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

/**
 * Returns ONLY the company's own library codes. Used by the seed script so
 * each company's codes go into the right library exactly once.
 *
 * The UI / data-layer reads from `listMockReadableCostCodes` instead, which
 * also folds in the global library.
 */
export function listMockCostCodes(companyId: string): CostCode[] {
  const libId = LIBRARY_BY_COMPANY[companyId];
  if (!libId) return [];
  return [...getStore().costCodes]
    .filter((c) => c.libraryId === libId)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Just the global library — exposed separately for the seed script. */
export function listMockGlobalCostCodes(): CostCode[] {
  return [...getStore().costCodes]
    .filter((c) => c.libraryId === GLOBAL_COST_CODE_LIBRARY_ID)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Company library + global library, ordered for UI rendering. This is what
 * the data layer uses in mock mode.
 */
export function listMockReadableCostCodes(companyId: string): CostCode[] {
  const libId = LIBRARY_BY_COMPANY[companyId];
  if (!libId) return [];
  return [...getStore().costCodes]
    .filter((c) => c.libraryId === libId || c.libraryId === GLOBAL_COST_CODE_LIBRARY_ID)
    .sort((a, b) => {
      const da = a.division ?? '~~~';
      const db = b.division ?? '~~~';
      if (da !== db) return da.localeCompare(db);
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.code.localeCompare(b.code);
    });
}

export function getMockCostCode(companyId: string, id: string): CostCode | undefined {
  const libId = LIBRARY_BY_COMPANY[companyId];
  return getStore().costCodes.find(
    (c) =>
      c.id === id &&
      (c.libraryId === libId || c.libraryId === GLOBAL_COST_CODE_LIBRARY_ID),
  );
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

// =====================================================================
// Invoice templates
// =====================================================================

export function listMockInvoiceTemplates(companyId: string): InvoiceTemplate[] {
  return [...getStore().invoiceTemplates]
    .filter((t) => t.companyId === companyId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getMockInvoiceTemplate(
  companyId: string,
  id: string,
): InvoiceTemplate | undefined {
  return getStore().invoiceTemplates.find(
    (t) => t.id === id && t.companyId === companyId,
  );
}

export type CreateInvoiceTemplateInput = Omit<
  InvoiceTemplate,
  'id' | 'companyId' | 'createdAt' | 'updatedAt'
>;

export function createMockInvoiceTemplate(
  companyId: string,
  input: CreateInvoiceTemplateInput,
): InvoiceTemplate {
  const store = getStore();
  const now = new Date();
  const tpl: InvoiceTemplate = {
    id: randomUUID(),
    companyId,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.invoiceTemplates.push(tpl);
  return tpl;
}

// =====================================================================
// Invoices
// =====================================================================

export function listMockInvoices(companyId: string): Invoice[] {
  return [...getStore().invoices]
    .filter((i) => i.companyId === companyId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export function getMockInvoice(companyId: string, id: string): Invoice | undefined {
  return getStore().invoices.find((i) => i.id === id && i.companyId === companyId);
}

export function getMockInvoiceLineItems(invoiceId: string): InvoiceLineItem[] {
  return getStore()
    .invoiceLineItems.filter((l) => l.invoiceId === invoiceId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getMockInvoicePayments(invoiceId: string): InvoicePayment[] {
  return getStore()
    .invoicePayments.filter((p) => p.invoiceId === invoiceId)
    .sort((a, b) => a.paidDate.localeCompare(b.paidDate));
}

export function listInvoicePaymentsForCompany(companyId: string): InvoicePayment[] {
  const store = getStore();
  // Exclude voided invoices' payments — same rule as the DB-mode listing.
  // Voided invoice = cash never hit the bank, so it must not show up in any
  // total. The payment rows stay in the store for audit / recovery but no
  // aggregation surfaces them.
  const invoiceIds = new Set(
    store.invoices
      .filter((i) => i.companyId === companyId && i.status !== 'void')
      .map((i) => i.id),
  );
  return store.invoicePayments.filter((p) => invoiceIds.has(p.invoiceId));
}

// =====================================================================
// Payments — first-class
// =====================================================================

export function listMockPayments(companyId: string): InvoicePayment[] {
  return [...listInvoicePaymentsForCompany(companyId)].sort((a, b) =>
    b.paidDate.localeCompare(a.paidDate),
  );
}

export function getMockPayment(
  companyId: string,
  id: string,
): InvoicePayment | undefined {
  const store = getStore();
  const payment = store.invoicePayments.find((p) => p.id === id);
  if (!payment) return undefined;
  const inv = store.invoices.find((i) => i.id === payment.invoiceId);
  if (!inv || inv.companyId !== companyId) return undefined;
  return payment;
}

export class DuplicatePaymentNumberError extends Error {
  constructor() {
    super('Payment number already used');
    this.name = 'DuplicatePaymentNumberError';
  }
}

export type CreatePaymentInput = {
  invoiceId: string;
  paymentNumber: string;
  paidDate: string;
  amount: string;
  method: string;
  reference: string | null;
  bankAccount: string | null;
  status: InvoicePayment['status'];
  notes: string | null;
};

/**
 * Recompute invoice.amountPaid and invoice.status based on the current set of
 * payments. Counts only payments with status in {received, applied} as "paid".
 * Status transitions:
 *   - balance <= 0  → paid
 *   - amountPaid > 0 → partial
 *   - else stays at sent / draft (overdue is derived from dueDate at render time)
 */
function recomputeInvoicePaymentState(invoiceId: string): void {
  const store = getStore();
  const inv = store.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  const total = Number(inv.total);
  let paid = 0;
  for (const p of store.invoicePayments) {
    if (p.invoiceId !== invoiceId) continue;
    if (p.status === 'received' || p.status === 'applied') {
      paid += Number(p.amount);
    }
  }
  // Round to 2dp string for storage.
  inv.amountPaid = paid.toFixed(2);
  if (paid >= total - 0.005) {
    inv.status = 'paid';
    inv.paidAt = new Date();
  } else if (paid > 0) {
    inv.status = 'partial';
    inv.paidAt = null;
  } else if (inv.status === 'paid' || inv.status === 'partial') {
    // Reverted (e.g., payment returned). Step back to "sent" if it was already sent.
    inv.status = 'sent';
    inv.paidAt = null;
  }
  inv.updatedAt = new Date();
}

/**
 * Public wrapper around the in-memory invoice payment-state recompute. Used
 * by the dual-backend `recomputeInvoicePaymentState` in
 * @/lib/data/invoice-payments for the demo path.
 */
export function recomputeInvoicePaymentStateInMemory(invoiceId: string): void {
  recomputeInvoicePaymentState(invoiceId);
}

export function createMockPayment(
  companyId: string,
  input: CreatePaymentInput,
): InvoicePayment {
  const store = getStore();
  // Verify invoice belongs to active company.
  const inv = store.invoices.find(
    (i) => i.id === input.invoiceId && i.companyId === companyId,
  );
  if (!inv) {
    throw new Error('Invoice not found in active company');
  }
  if (
    store.invoicePayments.some(
      (p) => p.paymentNumber === input.paymentNumber && p.paymentNumber !== '',
    )
  ) {
    throw new DuplicatePaymentNumberError();
  }
  const now = new Date();
  const payment: InvoicePayment = {
    id: randomUUID(),
    invoiceId: input.invoiceId,
    paymentNumber: input.paymentNumber,
    paidDate: input.paidDate,
    amount: input.amount,
    method: input.method,
    reference: input.reference,
    bankAccount: input.bankAccount,
    status: input.status,
    notes: input.notes,
    createdAt: now,
  };
  store.invoicePayments.push(payment);
  recomputeInvoicePaymentState(input.invoiceId);
  return payment;
}

/**
 * Mirror of the DB-mode deleteOrphanedPaymentsForVoidedInvoice. Hard-gates on
 * status === 'void' so the same safety contract holds in demo mode.
 */
export function deleteOrphanedPaymentsForVoidedInvoice(
  companyId: string,
  invoiceId: string,
): { deletedCount: number; deletedAmount: number } {
  const store = getStore();
  const inv = store.invoices.find(
    (i) => i.id === invoiceId && i.companyId === companyId,
  );
  if (!inv) {
    throw new Error('Invoice not found in active company');
  }
  if (inv.status !== 'void') {
    throw new Error('Refusing to delete payments: invoice is not voided.');
  }
  const toRemove = store.invoicePayments.filter((p) => p.invoiceId === invoiceId);
  if (toRemove.length === 0) return { deletedCount: 0, deletedAmount: 0 };
  const deletedAmount = toRemove.reduce((s, p) => s + Number(p.amount), 0);
  store.invoicePayments = store.invoicePayments.filter(
    (p) => p.invoiceId !== invoiceId,
  );
  recomputeInvoicePaymentState(invoiceId);
  return { deletedCount: toRemove.length, deletedAmount };
}

// =====================================================================
// Retainage releases — first-class
// =====================================================================

export class DuplicateRetainageReleaseNumberError extends Error {
  constructor() {
    super('Retainage release number already used');
    this.name = 'DuplicateRetainageReleaseNumberError';
  }
}

export class RetainageOverReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetainageOverReleaseError';
  }
}

export function listMockRetainageReleases(companyId: string): RetainageRelease[] {
  return [...getStore().retainageReleases]
    .filter((r) => r.companyId === companyId)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

export function getMockRetainageRelease(
  companyId: string,
  id: string,
): RetainageRelease | undefined {
  return getStore().retainageReleases.find(
    (r) => r.id === id && r.companyId === companyId,
  );
}

export function listRetainageReleasesForInvoice(
  invoiceId: string,
): RetainageRelease[] {
  return [...getStore().retainageReleases]
    .filter((r) => r.invoiceId === invoiceId)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
}

export function listRetainageReleasesForProject(
  projectId: string,
): RetainageRelease[] {
  return [...getStore().retainageReleases]
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
}

/**
 * Recompute invoice.retainageReleased from the persisted retainage_releases
 * table. Caps at retainageAmount so a partial-release plus cleanup stays
 * mathematically consistent.
 */
function recomputeInvoiceRetainageState(invoiceId: string): void {
  const store = getStore();
  const inv = store.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  let released = 0;
  for (const r of store.retainageReleases) {
    if (r.invoiceId === invoiceId) released += Number(r.amount);
  }
  inv.retainageReleased = released.toFixed(2);
  inv.updatedAt = new Date();
}

/**
 * Public wrapper around the in-memory invoice retainage-state recompute. Used
 * by the dual-backend `recomputeInvoiceRetainageState` in
 * @/lib/data/retainage-releases for the demo path.
 */
export function recomputeInvoiceRetainageStateInMemory(invoiceId: string): void {
  recomputeInvoiceRetainageState(invoiceId);
}

export type CreateRetainageReleaseInput = {
  invoiceId: string;
  releaseNumber: string;
  releaseDate: string;
  amount: string;
  paymentId: string | null;
  notes: string | null;
};

export function createMockRetainageRelease(
  companyId: string,
  input: CreateRetainageReleaseInput,
): RetainageRelease {
  const store = getStore();
  const inv = store.invoices.find(
    (i) => i.id === input.invoiceId && i.companyId === companyId,
  );
  if (!inv) {
    throw new Error('Invoice not found in active company');
  }
  if (
    input.releaseNumber !== '' &&
    store.retainageReleases.some(
      (r) =>
        r.companyId === companyId &&
        r.releaseNumber === input.releaseNumber,
    )
  ) {
    throw new DuplicateRetainageReleaseNumberError();
  }
  const heldAmount = Number(inv.retainageAmount);
  const alreadyReleased = Number(inv.retainageReleased);
  const incoming = Number(input.amount);
  const balance = heldAmount - alreadyReleased;
  if (incoming > balance + 0.005) {
    throw new RetainageOverReleaseError(
      `Cannot release ${input.amount}; only ${balance.toFixed(2)} of retainage remains held.`,
    );
  }
  const now = new Date();
  const release: RetainageRelease = {
    id: randomUUID(),
    companyId,
    invoiceId: input.invoiceId,
    projectId: inv.projectId,
    paymentId: input.paymentId,
    releaseNumber: input.releaseNumber,
    releaseDate: input.releaseDate,
    amount: input.amount,
    notes: input.notes,
    createdAt: now,
  };
  store.retainageReleases.push(release);
  recomputeInvoiceRetainageState(input.invoiceId);
  return release;
}

export function listInvoicesForProject(projectId: string): Invoice[] {
  return [...getStore().invoices]
    .filter((i) => i.projectId === projectId)
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

export class DuplicateInvoiceNumberError extends Error {
  constructor() {
    super('Invoice number already used');
    this.name = 'DuplicateInvoiceNumberError';
  }
}

export type CreateInvoiceInput = {
  number: string;
  projectId: string;
  proposalId: string | null;
  changeOrderId: string | null;
  templateId: string | null;
  status: Invoice['status'];
  billingType: Invoice['billingType'];
  invoiceDate: string;
  dueDate: string | null;
  subtotal: string;
  taxAmount: string;
  retainagePercent?: string;
  retainageAmount: string;
  retainageReleased?: string;
  expectedRetainageReleaseDate?: string | null;
  total: string;
  amountPaid: string;
  notes: string | null;
  termsOverride: string | null;
  // Project-metadata block — render only when the linked template has
  // `showProjectMetadata` on. PO # is the customer's purchase order; billing
  // label is a free-text "Billing #3 of 12" / "Final draw" tag.
  purchaseOrderNumber?: string | null;
  billingLabel?: string | null;
  // Display-only "30% of contract" tag for lump-sum / progress draws.
  percentOfContract?: string | null;
  lines: Array<{
    costCodeId: string | null;
    inventoryItemId?: string | null;
    description: string;
    unit: string | null;
    quantity: string;
    unitCost: string;
    lineTotal: string;
  }>;
};

export function createMockInvoice(
  companyId: string,
  input: CreateInvoiceInput,
): Invoice {
  const store = getStore();
  // Invoice numbers may repeat within a company (re-used across years).
  // No uniqueness check — identity is the UUID id. Mirrors the DB path.
  const now = new Date();
  const invoiceId = randomUUID();
  const invoice: Invoice = {
    id: invoiceId,
    companyId,
    projectId: input.projectId,
    accountingAccountId: null,
    proposalId: input.proposalId,
    changeOrderId: input.changeOrderId,
    templateId: input.templateId,
    number: input.number,
    status: input.status,
    billingType: input.billingType,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    subtotal: input.subtotal,
    taxAmount: input.taxAmount,
    retainagePercent: input.retainagePercent ?? '0.000',
    retainageAmount: input.retainageAmount,
    retainageReleased: input.retainageReleased ?? '0.00',
    expectedRetainageReleaseDate: input.expectedRetainageReleaseDate ?? null,
    total: input.total,
    amountPaid: input.amountPaid,
    notes: input.notes,
    termsOverride: input.termsOverride,
    // Project-metadata fields — now accepted on create. The action layer
    // forwards empty strings as null so the column stays clean.
    billingLabel: input.billingLabel ?? null,
    purchaseOrderNumber: input.purchaseOrderNumber ?? null,
    percentOfContract: input.percentOfContract ?? null,
    sentAt:
      input.status !== 'draft' && input.status !== 'void' ? now : null,
    paidAt: input.status === 'paid' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  store.invoices.push(invoice);

  input.lines.forEach((l, i) => {
    store.invoiceLineItems.push({
      id: randomUUID(),
      invoiceId,
      costCodeId: l.costCodeId,
      inventoryItemId: l.inventoryItemId ?? null,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
      sortOrder: i,
    });
  });

  return invoice;
}

// =====================================================================
// Project invoice summary (for project detail integration)
// =====================================================================

export type ProjectInvoiceSummary = {
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  /** Sum of invoice subtotals (revenue, ex-VAT). */
  totalInvoicedNet: number;
  /** Sum of invoice taxAmount (VAT we'll owe once collected). */
  totalInvoicedVat: number;
  /** Cash collected attributable to revenue (paid * net/gross share). */
  totalPaidNet: number;
  /** Cash collected attributable to VAT-on-behalf-of-government. */
  totalPaidVat: number;
  outstandingBalance: number;
  /** Outstanding net side (revenue not yet realized). */
  outstandingBalanceNet: number;
  /** Outstanding VAT side (not yet collected). */
  outstandingBalanceVat: number;
  retainageHeld: number;
  retainageReleased: number;
  retainageBalance: number;
};

export function computeProjectInvoiceSummary(projectId: string): ProjectInvoiceSummary {
  const store = getStore();
  const invs = store.invoices.filter((i) => i.projectId === projectId);
  let totalInvoiced = 0;
  let totalInvoicedNet = 0;
  let totalInvoicedVat = 0;
  let totalPaid = 0;
  let totalPaidNet = 0;
  let totalPaidVat = 0;
  let outstandingBalance = 0;
  let outstandingBalanceNet = 0;
  let outstandingBalanceVat = 0;
  let retainageHeld = 0;
  let retainageReleased = 0;
  for (const inv of invs) {
    if (inv.status === 'void') continue;
    // Compute paid from payment rows directly — matches the canonical
    // formula in @/modules/invoices/lib/financials and stays correct even
    // if `inv.amount_paid` is briefly stale.
    const subtotal = Number(inv.subtotal);
    const tax = Number(inv.taxAmount);
    const total = Number(inv.total);
    let paid = 0;
    for (const p of store.invoicePayments) {
      if (p.invoiceId !== inv.id) continue;
      if (p.status === 'received' || p.status === 'applied') {
        paid += Number(p.amount);
      }
    }
    const denom = subtotal + tax;
    const vatShare = denom > 0 ? tax / denom : 0;
    const paidVat = paid * vatShare;
    const paidNet = paid - paidVat;
    const balance = Math.max(0, total - paid);
    const balanceVat = balance * vatShare;
    const balanceNet = balance - balanceVat;
    totalInvoiced += total;
    totalInvoicedNet += subtotal;
    totalInvoicedVat += tax;
    totalPaid += paid;
    totalPaidNet += paidNet;
    totalPaidVat += paidVat;
    outstandingBalance += balance;
    outstandingBalanceNet += balanceNet;
    outstandingBalanceVat += balanceVat;
    retainageHeld += Number(inv.retainageAmount);
    retainageReleased += Number(inv.retainageReleased);
  }
  return {
    invoiceCount: invs.filter((i) => i.status !== 'void').length,
    totalInvoiced,
    totalInvoicedNet,
    totalInvoicedVat,
    totalPaid,
    totalPaidNet,
    totalPaidVat,
    outstandingBalance,
    outstandingBalanceNet,
    outstandingBalanceVat,
    retainageHeld,
    retainageReleased,
    retainageBalance: retainageHeld - retainageReleased,
  };
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
  | 'id'
  | 'companyId'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'vatRatePercent'
> & {
  // Optional so existing vendor-create call sites (import, seed, backfill)
  // compile unchanged; omitting it inserts NULL (not a VAT vendor).
  vatRatePercent?: string | null;
};

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
    vatRatePercent: input.vatRatePercent ?? null,
  };
  store.vendors.push(vendor);
  return vendor;
}

export function createMockProject(
  companyId: string,
  input: Omit<
    Project,
    | 'id'
    | 'companyId'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'reconciliationVerifiedAt'
    | 'reconciliationVerifiedRole'
    | 'reconciliationVerifiedNote'
  >,
): Project {
  const store = getStore();
  const now = new Date();
  const project: Project = {
    id: randomUUID(),
    companyId,
    reconciliationVerifiedAt: null,
    reconciliationVerifiedRole: null,
    reconciliationVerifiedNote: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.projects.push(project);
  return project;
}

/**
 * Set or clear the reconciliation-verified flag on an in-memory project.
 * Used by the dual-backend `markProjectVerified` in @/lib/data/projects.
 */
export function setProjectVerifiedInMemory(
  companyId: string,
  projectId: string,
  patch: {
    verifiedAt: Date | null;
    verifiedRole: string | null;
    verifiedNote: string | null;
  },
): Project | undefined {
  const store = getStore();
  const project = store.projects.find(
    (p) => p.id === projectId && p.companyId === companyId && !p.deletedAt,
  );
  if (!project) return undefined;
  project.reconciliationVerifiedAt = patch.verifiedAt;
  project.reconciliationVerifiedRole = patch.verifiedRole;
  project.reconciliationVerifiedNote = patch.verifiedNote;
  project.updatedAt = new Date();
  return project;
}

export function createMockCostCode(
  companyId: string,
  input: Pick<CostCode, 'code' | 'description' | 'category'> &
    Partial<Pick<CostCode, 'division' | 'sortOrder' | 'notes' | 'defaultCost'>>,
): CostCode {
  const store = getStore();
  const libraryId = LIBRARY_BY_COMPANY[companyId];
  if (!libraryId) throw new Error('No cost code library for company');
  // Reject collisions inside the company library OR with the read-only global
  // library — both are visible to this company so a duplicate would be
  // ambiguous in pickers / reports.
  if (
    store.costCodes.some(
      (c) =>
        c.code === input.code &&
        (c.libraryId === libraryId || c.libraryId === GLOBAL_COST_CODE_LIBRARY_ID),
    )
  ) {
    throw new DuplicateCostCodeError();
  }
  const now = new Date();
  const code: CostCode = {
    id: randomUUID(),
    libraryId,
    code: input.code,
    description: input.description,
    category: input.category,
    division: input.division ?? null,
    parentId: null,
    isActive: true,
    sortOrder: input.sortOrder ?? 0,
    notes: input.notes ?? null,
    defaultCost: input.defaultCost ?? null,
    createdAt: now,
    updatedAt: now,
  };
  store.costCodes.push(code);
  return code;
}

/**
 * Update a cost code in the mock store. Returns the updated row, or undefined
 * if no row matches. Codes from the global library are read-only — attempting
 * to update one returns undefined without raising so the caller can show a
 * friendly message.
 */
export function updateMockCostCode(
  companyId: string,
  id: string,
  patch: Partial<
    Pick<CostCode, 'description' | 'category' | 'division' | 'sortOrder' | 'isActive' | 'notes'>
  >,
): CostCode | undefined {
  const store = getStore();
  const libId = LIBRARY_BY_COMPANY[companyId];
  if (!libId) return undefined;
  const code = store.costCodes.find((c) => c.id === id && c.libraryId === libId);
  if (!code) return undefined;
  if (patch.description !== undefined) code.description = patch.description;
  if (patch.category !== undefined) code.category = patch.category;
  if (patch.division !== undefined) code.division = patch.division;
  if (patch.sortOrder !== undefined) code.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) code.isActive = patch.isActive;
  if (patch.notes !== undefined) code.notes = patch.notes;
  code.updatedAt = new Date();
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
    submittedAt:
      input.status === 'internal_review' ||
      input.status === 'sent' ||
      input.status === 'approved' ||
      input.status === 'rejected'
        ? now
        : null,
    sentAt:
      input.status === 'sent' || input.status === 'approved' || input.status === 'rejected'
        ? now
        : null,
    approvedAt: input.status === 'approved' ? now : null,
    rejectedAt: input.status === 'rejected' ? now : null,
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
      inventoryItemId: null,
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
    submittedAt:
      input.status !== 'draft' && input.status !== 'expired' ? now : null,
    sentAt:
      input.status !== 'draft' && input.status !== 'expired' ? now : null,
    viewedAt:
      input.status === 'viewed' ||
      input.status === 'accepted' ||
      input.status === 'approved' ||
      input.status === 'declined' ||
      input.status === 'rejected'
        ? now
        : null,
    approvedAt:
      input.status === 'approved' || input.status === 'accepted' ? now : null,
    rejectedAt:
      input.status === 'rejected' || input.status === 'declined' ? now : null,
    acceptedAt:
      input.status === 'accepted' || input.status === 'approved' ? now : null,
    declinedAt:
      input.status === 'declined' || input.status === 'rejected' ? now : null,
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

/**
 * Public wrapper around the in-memory CO->project rollup. Used by the
 * dual-backend `applyApprovedCOToProject` in @/lib/data/change-orders for the
 * demo path.
 */
export function applyApprovedCOToProjectInMemory(
  projectId: string,
  amount: number,
): void {
  applyApprovedCOToProject(getStore(), projectId, amount);
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
    inventoryItemId?: string | null;
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
      inventoryItemId: l.inventoryItemId ?? null,
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

// =====================================================================
// Activity log
// =====================================================================

export type EntityType =
  | 'estimate'
  | 'proposal'
  | 'change_order'
  | 'purchase_order'
  | 'invoice'
  | 'payment'
  | 'retainage_release';

export type AppendActivityInput = {
  entityType: EntityType;
  entityId: string;
  kind: string;
  summary: string;
  actorRole: string | null;
};

export function appendActivity(
  companyId: string,
  input: AppendActivityInput,
): ActivityLogEntry {
  const store = getStore();
  const entry: ActivityLogEntry = {
    id: randomUUID(),
    companyId,
    entityType: input.entityType,
    entityId: input.entityId,
    kind: input.kind,
    summary: input.summary,
    actorRole: input.actorRole,
    createdAt: new Date(),
  };
  store.activityLog.push(entry);
  return entry;
}

export function listActivityForEntity(
  companyId: string,
  entityType: EntityType,
  entityId: string,
): ActivityLogEntry[] {
  return [...getStore().activityLog]
    .filter(
      (e) =>
        e.companyId === companyId &&
        e.entityType === entityType &&
        e.entityId === entityId,
    )
    .sort((a, b) => +b.createdAt - +a.createdAt);
}

// =====================================================================
// Generic status updaters (used by transition action)
// =====================================================================

type StatusEntityKey =
  | 'estimate'
  | 'proposal'
  | 'change_order'
  | 'purchase_order'
  | 'invoice'
  | 'payment';

export class EntityNotFoundError extends Error {
  constructor(message = 'Entity not found in active company') {
    super(message);
    this.name = 'EntityNotFoundError';
  }
}

/**
 * Look up an entity by company + id and apply a status patch. Also stamps
 * relevant timestamp columns (submittedAt / approvedAt / paidAt / etc.).
 *
 * Dispatches between Postgres (when DATABASE_URL is set, for the 5 entities
 * we've migrated: estimate / proposal / change_order / purchase_order — invoice
 * and payment still live in the mock store this phase) and the in-memory
 * fallback. Returns the previous status string for use in the audit-log
 * summary.
 */
export type UpdateEntityStatusOptions = {
  /**
   * For invoice mark_paid transitions only. ISO YYYY-MM-DD. When provided,
   * the synthetic "balance payment" the system auto-records uses this date
   * instead of today — important for accrual VAT / quarterly cash reports.
   */
  paidDate?: string;
};

export async function updateEntityStatus(
  companyId: string,
  entity: StatusEntityKey,
  id: string,
  newStatus: string,
  options?: UpdateEntityStatusOptions,
): Promise<{ previousStatus: string }> {
  if (isDatabaseConfigured()) {
    const dbResult = await updateEntityStatusDb(
      companyId,
      entity,
      id,
      newStatus,
      options,
    );
    if (dbResult) return dbResult;
    // For invoice / payment we fall through to the in-memory branch below
    // because those modules haven't been migrated yet.
  }

  const store = getStore();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  switch (entity) {
    case 'estimate': {
      const e = store.estimates.find((x) => x.id === id && x.companyId === companyId);
      if (!e) throw new EntityNotFoundError();
      const prev = e.status;
      e.status = newStatus as Estimate['status'];
      if (newStatus === 'internal_review' && !e.submittedAt) e.submittedAt = now;
      if (newStatus === 'sent' && !e.sentAt) e.sentAt = now;
      if (newStatus === 'approved') e.approvedAt = now;
      if (newStatus === 'rejected') e.rejectedAt = now;
      e.updatedAt = now;
      return { previousStatus: prev };
    }
    case 'proposal': {
      const p = store.proposals.find((x) => x.id === id && x.companyId === companyId);
      if (!p) throw new EntityNotFoundError();
      const prev = p.status;
      p.status = newStatus as Proposal['status'];
      if (newStatus === 'sent' && !p.sentAt) p.sentAt = now;
      if (newStatus === 'approved') {
        p.approvedAt = now;
        p.acceptedAt = now;
      }
      if (newStatus === 'rejected') {
        p.rejectedAt = now;
        p.declinedAt = now;
      }
      p.updatedAt = now;
      return { previousStatus: prev };
    }
    case 'change_order': {
      const c = store.changeOrders.find((x) => x.id === id && x.companyId === companyId);
      if (!c) throw new EntityNotFoundError();
      const prev = c.status;
      c.status = newStatus as ChangeOrder['status'];
      if (newStatus === 'submitted' && !c.submittedAt) c.submittedAt = today;
      if (newStatus === 'approved' && prev !== 'approved') {
        c.approvedAt = today;
        if (!c.customerSignedAt) c.customerSignedAt = now;
        // Apply approved CO to project contract value (matches createMockChangeOrder).
        applyApprovedCOToProject(store, c.projectId, Number(c.total));
      }
      if (newStatus === 'rejected') c.rejectedAt = today;
      // Voiding an approved CO must reverse the approval's contract bump.
      if (newStatus === 'void' && prev === 'approved') {
        applyApprovedCOToProject(store, c.projectId, -Number(c.total));
      }
      c.updatedAt = now;
      return { previousStatus: prev };
    }
    case 'purchase_order': {
      const po = store.purchaseOrders.find(
        (x) => x.id === id && x.companyId === companyId,
      );
      if (!po) throw new EntityNotFoundError();
      const prev = po.status;
      po.status = newStatus as PurchaseOrder['status'];
      if (newStatus === 'issued' && !po.issuedAt) po.issuedAt = now;
      if (newStatus === 'closed') po.closedAt = now;
      po.updatedAt = now;
      return { previousStatus: prev };
    }
    case 'invoice': {
      const inv = store.invoices.find((x) => x.id === id && x.companyId === companyId);
      if (!inv) throw new EntityNotFoundError();
      const prev = inv.status;

      // CRITICAL: when transitioning to "paid", we cannot simply flip the
      // status field — `invoices.amount_paid` is the cache the dashboard / AR
      // / aging logic all read. Without a matching payment row, that cache
      // stays stale and the dashboard would still show the invoice in
      // outstanding AR. So we record a balancing payment for the remaining
      // balance, then run the recompute (which derives status from numbers).
      if (newStatus === 'paid') {
        const total = Number(inv.total);
        let alreadyPaid = 0;
        for (const p of store.invoicePayments) {
          if (p.invoiceId !== inv.id) continue;
          if (p.status === 'received' || p.status === 'applied') {
            alreadyPaid += Number(p.amount);
          }
        }
        const remaining = Math.max(0, total - alreadyPaid);
        if (remaining > 0.005) {
          store.invoicePayments.push({
            id: randomUUID(),
            invoiceId: inv.id,
            paymentNumber: '', // empty — real payments use sequence numbers
            // Caller may supply the real payment date so VAT/cash reports
            // bucket into the correct quarter. Falls back to today.
            paidDate: options?.paidDate ?? today,
            amount: remaining.toFixed(2),
            method: 'manual_mark_paid',
            reference: null,
            bankAccount: null,
            status: 'received',
            notes: 'Auto-recorded by Mark Paid action',
            createdAt: now,
          });
        }
        // recomputeInvoicePaymentState below will set status='paid',
        // amountPaid=total, paidAt=now, and bump updatedAt.
        recomputeInvoicePaymentStateExternal(inv.id);
        return { previousStatus: prev };
      }

      // Non-paid transitions (mark sent / mark overdue) leave amount_paid
      // alone but still must keep the derived status honest. Set the field,
      // then re-run recompute so e.g. flipping "paid → sent" after a refund
      // payment keeps the numbers consistent with the (manual) override.
      inv.status = newStatus as Invoice['status'];
      if (newStatus === 'sent' && !inv.sentAt) inv.sentAt = now;
      inv.updatedAt = now;
      return { previousStatus: prev };
    }
    case 'payment': {
      const p = store.invoicePayments.find((x) => x.id === id);
      if (!p) throw new EntityNotFoundError();
      const inv = store.invoices.find((i) => i.id === p.invoiceId);
      if (!inv || inv.companyId !== companyId) throw new EntityNotFoundError();
      const prev = p.status;
      p.status = newStatus as InvoicePayment['status'];
      // Reapply payment-state recompute since received/applied toggles drive
      // invoice amountPaid and status.
      recomputeInvoicePaymentStateExternal(p.invoiceId);
      return { previousStatus: prev };
    }
  }
}

/**
 * DB branch of updateEntityStatus. Returns null for entities that haven't
 * been migrated to Postgres yet (invoice / payment), letting the caller fall
 * through to the in-memory branch.
 */
async function updateEntityStatusDb(
  companyId: string,
  entity: StatusEntityKey,
  id: string,
  newStatus: string,
  options?: UpdateEntityStatusOptions,
): Promise<{ previousStatus: string } | null> {
  // Local imports to keep this function tree-shakeable in demo mode.
  const { eq, and, sql } = await import('drizzle-orm');
  const {
    estimates: estimatesTable,
    proposals: proposalsTable,
    changeOrders: changeOrdersTable,
    purchaseOrders: purchaseOrdersTable,
    projects: projectsTable,
  } = await import('@/db/schema');
  const db = getDb()!;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  switch (entity) {
    case 'estimate': {
      const cur = await db
        .select()
        .from(estimatesTable)
        .where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)))
        .limit(1);
      if (cur.length === 0) throw new EntityNotFoundError();
      const e = cur[0];
      const prev = e.status;
      const patch: Record<string, unknown> = {
        status: newStatus,
        updatedAt: now,
      };
      if (newStatus === 'internal_review' && !e.submittedAt) patch.submittedAt = now;
      if (newStatus === 'sent' && !e.sentAt) patch.sentAt = now;
      if (newStatus === 'approved') patch.approvedAt = now;
      if (newStatus === 'rejected') patch.rejectedAt = now;
      await db
        .update(estimatesTable)
        .set(patch)
        .where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)));
      return { previousStatus: prev };
    }
    case 'proposal': {
      const cur = await db
        .select()
        .from(proposalsTable)
        .where(and(eq(proposalsTable.id, id), eq(proposalsTable.companyId, companyId)))
        .limit(1);
      if (cur.length === 0) throw new EntityNotFoundError();
      const p = cur[0];
      const prev = p.status;
      const patch: Record<string, unknown> = {
        status: newStatus,
        updatedAt: now,
      };
      if (newStatus === 'sent' && !p.sentAt) patch.sentAt = now;
      if (newStatus === 'approved') {
        patch.approvedAt = now;
        patch.acceptedAt = now;
      }
      if (newStatus === 'rejected') {
        patch.rejectedAt = now;
        patch.declinedAt = now;
      }
      await db
        .update(proposalsTable)
        .set(patch)
        .where(and(eq(proposalsTable.id, id), eq(proposalsTable.companyId, companyId)));
      return { previousStatus: prev };
    }
    case 'change_order': {
      const cur = await db
        .select()
        .from(changeOrdersTable)
        .where(
          and(eq(changeOrdersTable.id, id), eq(changeOrdersTable.companyId, companyId)),
        )
        .limit(1);
      if (cur.length === 0) throw new EntityNotFoundError();
      const c = cur[0];
      const prev = c.status;
      const patch: Record<string, unknown> = {
        status: newStatus,
        updatedAt: now,
      };
      if (newStatus === 'submitted' && !c.submittedAt) patch.submittedAt = today;
      if (newStatus === 'approved') {
        patch.approvedAt = today;
        if (!c.customerSignedAt) patch.customerSignedAt = now;
      }
      if (newStatus === 'rejected') patch.rejectedAt = today;
      await db
        .update(changeOrdersTable)
        .set(patch)
        .where(
          and(eq(changeOrdersTable.id, id), eq(changeOrdersTable.companyId, companyId)),
        );
      // Roll the approved CO total into the project contract value.
      // Embed amount as a numeric literal — see comment in
      // applyApprovedCOToProject for why we don't bind it as a parameter.
      if (newStatus === 'approved' && prev !== 'approved') {
        const amount = Number(c.total);
        const lit = sql.raw(`(${amount.toFixed(2)})::numeric`);
        await db
          .update(projectsTable)
          .set({
            contractValue: sql`${projectsTable.contractValue} + ${lit}`,
            totalChangeOrders: sql`${projectsTable.totalChangeOrders} + ${lit}`,
            updatedAt: now,
          })
          .where(eq(projectsTable.id, c.projectId));
      }
      // Voiding an APPROVED CO reverses the bump applied at approval.
      // Any other transition into void (from draft/submitted/rejected) had
      // no contract-value side effect, so nothing to reverse.
      if (newStatus === 'void' && prev === 'approved') {
        const amount = Number(c.total);
        const lit = sql.raw(`(${amount.toFixed(2)})::numeric`);
        await db
          .update(projectsTable)
          .set({
            contractValue: sql`${projectsTable.contractValue} - ${lit}`,
            totalChangeOrders: sql`${projectsTable.totalChangeOrders} - ${lit}`,
            updatedAt: now,
          })
          .where(eq(projectsTable.id, c.projectId));
      }
      return { previousStatus: prev };
    }
    case 'purchase_order': {
      const cur = await db
        .select()
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.id, id),
            eq(purchaseOrdersTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (cur.length === 0) throw new EntityNotFoundError();
      const po = cur[0];
      const prev = po.status;
      const patch: Record<string, unknown> = {
        status: newStatus,
        updatedAt: now,
      };
      if (newStatus === 'issued' && !po.issuedAt) patch.issuedAt = now;
      if (newStatus === 'closed') patch.closedAt = now;
      await db
        .update(purchaseOrdersTable)
        .set(patch)
        .where(
          and(
            eq(purchaseOrdersTable.id, id),
            eq(purchaseOrdersTable.companyId, companyId),
          ),
        );
      return { previousStatus: prev };
    }
    case 'invoice': {
      const {
        invoices: invoicesTable,
        invoicePayments: invoicePaymentsTable,
      } = await import('@/db/schema');
      const cur = await db
        .select()
        .from(invoicesTable)
        .where(
          and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)),
        )
        .limit(1);
      if (cur.length === 0) throw new EntityNotFoundError();
      const inv = cur[0];
      const prev = inv.status;

      // See the parallel block in the in-memory branch above for the
      // architectural rationale: "Mark Paid" must record a balancing payment
      // row so amount_paid (the cache the dashboard reads) stays truthful.
      if (newStatus === 'paid') {
        const allPayments = await db
          .select()
          .from(invoicePaymentsTable)
          .where(eq(invoicePaymentsTable.invoiceId, id));
        let alreadyPaid = 0;
        for (const p of allPayments) {
          if (p.status === 'received' || p.status === 'applied') {
            alreadyPaid += Number(p.amount);
          }
        }
        const total = Number(inv.total);
        const remaining = Math.max(0, total - alreadyPaid);
        if (remaining > 0.005) {
          await db.insert(invoicePaymentsTable).values({
            invoiceId: id,
            paymentNumber: '',
            // Use the operator-supplied paid date when provided so VAT and
            // cash-this-month reports bucket the synthetic payment into the
            // right quarter; falls back to today if missing.
            paidDate: options?.paidDate ?? today,
            amount: remaining.toFixed(2),
            method: 'manual_mark_paid',
            reference: null,
            bankAccount: null,
            status: 'received',
            notes: 'Auto-recorded by Mark Paid action',
          });
        }
        const { recomputeInvoicePaymentState } = await import(
          '@/lib/data/invoice-payments'
        );
        await recomputeInvoicePaymentState(id);
        return { previousStatus: prev };
      }

      const patch: Record<string, unknown> = {
        status: newStatus,
        updatedAt: now,
      };
      if (newStatus === 'sent' && !inv.sentAt) patch.sentAt = now;
      await db
        .update(invoicesTable)
        .set(patch)
        .where(
          and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)),
        );
      return { previousStatus: prev };
    }
    case 'payment': {
      const { invoices: invoicesTable, invoicePayments: invoicePaymentsTable } =
        await import('@/db/schema');
      const cur = await db
        .select({ p: invoicePaymentsTable, invoice: invoicesTable })
        .from(invoicePaymentsTable)
        .innerJoin(invoicesTable, eq(invoicePaymentsTable.invoiceId, invoicesTable.id))
        .where(
          and(
            eq(invoicePaymentsTable.id, id),
            eq(invoicesTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (cur.length === 0) throw new EntityNotFoundError();
      const p = cur[0].p;
      const prev = p.status;
      await db
        .update(invoicePaymentsTable)
        .set({ status: newStatus as InvoicePayment['status'] })
        .where(eq(invoicePaymentsTable.id, id));
      // After flipping payment status, invoice amountPaid + status must be
      // recomputed (since received/applied counts toward paid).
      const { recomputeInvoicePaymentState } = await import(
        '@/lib/data/invoice-payments'
      );
      await recomputeInvoicePaymentState(p.invoiceId);
      return { previousStatus: prev };
    }
  }
}

/**
 * Public wrapper around the (file-private) recompute used by createMockPayment.
 * Exposed so updateEntityStatus can re-run it after status flips.
 */
function recomputeInvoicePaymentStateExternal(invoiceId: string): void {
  const store = getStore();
  const inv = store.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  const total = Number(inv.total);
  let paid = 0;
  for (const p of store.invoicePayments) {
    if (p.invoiceId !== invoiceId) continue;
    if (p.status === 'received' || p.status === 'applied') {
      paid += Number(p.amount);
    }
  }
  inv.amountPaid = paid.toFixed(2);
  if (paid >= total - 0.005) {
    inv.status = 'paid';
    inv.paidAt = new Date();
  } else if (paid > 0) {
    inv.status = 'partial';
    inv.paidAt = null;
  } else if (inv.status === 'paid' || inv.status === 'partial') {
    inv.status = 'sent';
    inv.paidAt = null;
  }
  inv.updatedAt = new Date();
}

// =====================================================================
// Edit / soft-delete for customers, vendors, projects.
// =====================================================================
//
// Mirrors the matching DB-backed operations in src/lib/data/{customers,
// vendors,projects}.ts. Soft-delete sets deletedAt; list/get filter by
// deletedAt IS NULL so archived rows disappear from the UI but FK
// references on dependent records keep working.

export function updateMockCustomer(
  companyId: string,
  id: string,
  patch: Partial<Omit<Customer, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
): Customer | undefined {
  const store = getStore();
  const c = store.customers.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!c) return undefined;
  Object.assign(c, patch, { updatedAt: new Date() });
  return c;
}

export function softDeleteMockCustomer(
  companyId: string,
  id: string,
): Customer | undefined {
  const store = getStore();
  const c = store.customers.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!c) return undefined;
  const now = new Date();
  c.deletedAt = now;
  c.updatedAt = now;
  return c;
}

export function updateMockVendor(
  companyId: string,
  id: string,
  patch: Partial<Omit<Vendor, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
): Vendor | undefined {
  const store = getStore();
  const v = store.vendors.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!v) return undefined;
  Object.assign(v, patch, { updatedAt: new Date() });
  return v;
}

export function softDeleteMockVendor(
  companyId: string,
  id: string,
): Vendor | undefined {
  const store = getStore();
  const v = store.vendors.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!v) return undefined;
  const now = new Date();
  v.deletedAt = now;
  v.updatedAt = now;
  return v;
}

export function updateMockProject(
  companyId: string,
  id: string,
  patch: Partial<
    Omit<
      Project,
      | 'id'
      | 'companyId'
      | 'createdAt'
      | 'updatedAt'
      | 'deletedAt'
      | 'reconciliationVerifiedAt'
      | 'reconciliationVerifiedRole'
      | 'reconciliationVerifiedNote'
    >
  >,
): Project | undefined {
  const store = getStore();
  const p = store.projects.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!p) return undefined;
  Object.assign(p, patch, { updatedAt: new Date() });
  return p;
}

export function softDeleteMockProject(
  companyId: string,
  id: string,
): Project | undefined {
  const store = getStore();
  const p = store.projects.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!p) return undefined;
  const now = new Date();
  p.deletedAt = now;
  p.updatedAt = now;
  return p;
}

// =====================================================================
// Header-only edits for estimates / invoices / purchase orders.
// =====================================================================
//
// Mirrors the matching DB-backed `update*Header` operations. Line items,
// totals, status, and lifecycle fields are deliberately NOT touched —
// these helpers only patch the metadata fields the edit form exposes.
// The action layer gates these to status='draft' so receipts / payments /
// retainage tracking can't be silently corrupted by an edit on a record
// already in motion.

export function updateMockEstimateHeader(
  companyId: string,
  id: string,
  patch: { validUntil: string | null },
): Estimate | undefined {
  const store = getStore();
  const e = store.estimates.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!e) return undefined;
  e.validUntil = patch.validUntil;
  e.updatedAt = new Date();
  return e;
}

export function updateMockInvoiceHeader(
  companyId: string,
  id: string,
  patch: {
    invoiceDate: string;
    dueDate: string | null;
    billingType: Invoice['billingType'];
    notes: string | null;
    termsOverride: string | null;
    expectedRetainageReleaseDate: string | null;
  },
): Invoice | undefined {
  const store = getStore();
  const inv = store.invoices.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!inv) return undefined;
  inv.invoiceDate = patch.invoiceDate;
  inv.dueDate = patch.dueDate;
  inv.billingType = patch.billingType;
  inv.notes = patch.notes;
  inv.termsOverride = patch.termsOverride;
  inv.expectedRetainageReleaseDate = patch.expectedRetainageReleaseDate;
  inv.updatedAt = new Date();
  return inv;
}

/**
 * Full-form invoice update for the mock store. Mirrors the DB-backed
 * `updateInvoiceFull` in @/lib/data/invoices: replaces line items in
 * place, writes back the totals, then re-runs the payment recompute so
 * amount_paid + status reflect the new total.
 */
export function updateMockInvoiceFull(
  companyId: string,
  id: string,
  patch: {
    billingType: Invoice['billingType'];
    changeOrderId: string | null;
    invoiceDate: string;
    dueDate: string | null;
    subtotal: string;
    taxAmount: string;
    retainagePercent: string;
    retainageAmount: string;
    expectedRetainageReleaseDate: string | null;
    total: string;
    notes: string | null;
    termsOverride: string | null;
    purchaseOrderNumber: string | null;
    billingLabel: string | null;
    percentOfContract: string | null;
    lines: Array<{
      costCodeId: string | null;
      description: string;
      unit: string | null;
      quantity: string;
      unitCost: string;
      lineTotal: string;
    }>;
  },
): Invoice | undefined {
  const store = getStore();
  const inv = store.invoices.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!inv) return undefined;

  // Replace line items: drop existing, insert new in order. Keeping the
  // invoice id stable preserves payment FK linkage.
  store.invoiceLineItems = store.invoiceLineItems.filter(
    (l) => l.invoiceId !== id,
  );
  for (let i = 0; i < patch.lines.length; i++) {
    const l = patch.lines[i];
    store.invoiceLineItems.push({
      id: randomUUID(),
      invoiceId: id,
      costCodeId: l.costCodeId,
      inventoryItemId: null,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
      sortOrder: i,
    });
  }

  inv.billingType = patch.billingType;
  inv.changeOrderId = patch.changeOrderId;
  inv.invoiceDate = patch.invoiceDate;
  inv.dueDate = patch.dueDate;
  inv.subtotal = patch.subtotal;
  inv.taxAmount = patch.taxAmount;
  inv.retainagePercent = patch.retainagePercent;
  inv.retainageAmount = patch.retainageAmount;
  inv.expectedRetainageReleaseDate = patch.expectedRetainageReleaseDate;
  inv.total = patch.total;
  inv.notes = patch.notes;
  inv.termsOverride = patch.termsOverride;
  inv.purchaseOrderNumber = patch.purchaseOrderNumber;
  inv.billingLabel = patch.billingLabel;
  inv.percentOfContract = patch.percentOfContract;
  inv.updatedAt = new Date();

  // Re-derive amount_paid + status from existing payment rows against the
  // new total. recomputeInvoicePaymentState handles overpayment (status →
  // paid even if total dropped below paid sum) and underpayment.
  recomputeInvoicePaymentState(id);
  return inv;
}

/**
 * Hard-delete a draft invoice. Returns false (and changes nothing) if the
 * invoice has payment rows or retainage releases attached, or is not a
 * draft. Cascades line items.
 */
export function deleteMockDraftInvoice(
  companyId: string,
  id: string,
): boolean {
  const store = getStore();
  const inv = store.invoices.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!inv) return false;
  if (inv.status !== 'draft') return false;
  const hasPayments = store.invoicePayments.some((p) => p.invoiceId === id);
  if (hasPayments) return false;
  const hasReleases = store.retainageReleases.some(
    (r) => r.invoiceId === id,
  );
  if (hasReleases) return false;

  store.invoiceLineItems = store.invoiceLineItems.filter(
    (l) => l.invoiceId !== id,
  );
  store.invoices = store.invoices.filter((x) => x.id !== id);
  return true;
}

export function updateMockPurchaseOrderHeader(
  companyId: string,
  id: string,
  patch: {
    issueDate: string | null;
    expectedDeliveryDate: string | null;
    shipToAddressLine1: string | null;
    shipToCity: string | null;
    shipToState: string | null;
    shipToPostalCode: string | null;
    notes: string | null;
  },
): PurchaseOrder | undefined {
  const store = getStore();
  const po = store.purchaseOrders.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!po) return undefined;
  po.issueDate = patch.issueDate;
  po.expectedDeliveryDate = patch.expectedDeliveryDate;
  po.shipToAddressLine1 = patch.shipToAddressLine1;
  po.shipToCity = patch.shipToCity;
  po.shipToState = patch.shipToState;
  po.shipToPostalCode = patch.shipToPostalCode;
  po.notes = patch.notes;
  po.updatedAt = new Date();
  return po;
}

// =====================================================================
// Employees (payroll Phase 1)
// =====================================================================

export type CreateEmployeeInput = Omit<
  Employee,
  'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export function listMockEmployees(companyId: string): Employee[] {
  return getStore()
    .employees.filter((e) => e.companyId === companyId && !e.deletedAt)
    .sort((a, b) => {
      const an = `${a.lastName} ${a.firstName}`.toLowerCase();
      const bn = `${b.lastName} ${b.firstName}`.toLowerCase();
      return an.localeCompare(bn);
    });
}

export function getMockEmployee(
  companyId: string,
  id: string,
): Employee | undefined {
  return getStore().employees.find(
    (e) => e.id === id && e.companyId === companyId && !e.deletedAt,
  );
}

export function createMockEmployee(
  companyId: string,
  input: CreateEmployeeInput,
): Employee {
  const store = getStore();
  const now = new Date();
  const employee: Employee = {
    id: randomUUID(),
    companyId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.employees.push(employee);
  return employee;
}

export function updateMockEmployee(
  companyId: string,
  id: string,
  patch: Partial<
    Omit<Employee, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'deletedAt'>
  >,
): Employee | undefined {
  const store = getStore();
  const e = store.employees.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!e) return undefined;
  Object.assign(e, patch, { updatedAt: new Date() });
  return e;
}

export function softDeleteMockEmployee(
  companyId: string,
  id: string,
): Employee | undefined {
  const store = getStore();
  const e = store.employees.find(
    (x) => x.id === id && x.companyId === companyId && !x.deletedAt,
  );
  if (!e) return undefined;
  const now = new Date();
  e.deletedAt = now;
  e.updatedAt = now;
  return e;
}

// =====================================================================
// Pay periods (payroll Phase 2)
// =====================================================================

export type CreatePayPeriodInput = Omit<
  PayPeriod,
  'id' | 'companyId' | 'createdAt' | 'updatedAt'
>;

export function listMockPayPeriods(companyId: string): PayPeriod[] {
  return getStore()
    .payPeriods.filter((p) => p.companyId === companyId)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

export function getMockPayPeriod(
  companyId: string,
  id: string,
): PayPeriod | undefined {
  return getStore().payPeriods.find(
    (p) => p.id === id && p.companyId === companyId,
  );
}

export function getMockPayPeriodByStart(
  companyId: string,
  startDate: string,
): PayPeriod | undefined {
  return getStore().payPeriods.find(
    (p) => p.companyId === companyId && p.startDate === startDate,
  );
}

export function createMockPayPeriod(
  companyId: string,
  input: CreatePayPeriodInput,
): PayPeriod {
  const store = getStore();
  const now = new Date();
  const period: PayPeriod = {
    id: randomUUID(),
    companyId,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.payPeriods.push(period);
  return period;
}

export function updateMockPayPeriod(
  companyId: string,
  id: string,
  patch: Partial<
    Omit<PayPeriod, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>
  >,
): PayPeriod | undefined {
  const store = getStore();
  const p = store.payPeriods.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!p) return undefined;
  Object.assign(p, patch, { updatedAt: new Date() });
  return p;
}

// =====================================================================
// Time entries (payroll Phase 2)
// =====================================================================

export type CreateTimeEntryInput = Omit<
  TimeEntry,
  'id' | 'companyId' | 'createdAt' | 'updatedAt'
>;

export function listMockTimeEntries(
  companyId: string,
  filters?: { payPeriodId?: string; employeeId?: string; projectId?: string },
): TimeEntry[] {
  return getStore()
    .timeEntries.filter((t) => {
      if (t.companyId !== companyId) return false;
      if (filters?.payPeriodId && t.payPeriodId !== filters.payPeriodId) return false;
      if (filters?.employeeId && t.employeeId !== filters.employeeId) return false;
      if (filters?.projectId && t.projectId !== filters.projectId) return false;
      return true;
    })
    .sort((a, b) => (a.workDate < b.workDate ? 1 : -1));
}

export function getMockTimeEntry(
  companyId: string,
  id: string,
): TimeEntry | undefined {
  return getStore().timeEntries.find(
    (t) => t.id === id && t.companyId === companyId,
  );
}

export function createMockTimeEntry(
  companyId: string,
  input: CreateTimeEntryInput,
): TimeEntry {
  const store = getStore();
  const now = new Date();
  const entry: TimeEntry = {
    id: randomUUID(),
    companyId,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.timeEntries.push(entry);
  return entry;
}

export function updateMockTimeEntry(
  companyId: string,
  id: string,
  patch: Partial<
    Omit<TimeEntry, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>
  >,
): TimeEntry | undefined {
  const store = getStore();
  const t = store.timeEntries.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!t) return undefined;
  Object.assign(t, patch, { updatedAt: new Date() });
  return t;
}

export function deleteMockTimeEntry(
  companyId: string,
  id: string,
): TimeEntry | undefined {
  const store = getStore();
  const idx = store.timeEntries.findIndex(
    (t) => t.id === id && t.companyId === companyId,
  );
  if (idx === -1) return undefined;
  const [removed] = store.timeEntries.splice(idx, 1);
  return removed;
}

// =====================================================================
// Period pay overrides (payroll Phase 4.6)
// =====================================================================

export type UpsertPeriodPayOverrideInput = {
  employeeId: string;
  payPeriodId: string;
  grossAmount: string;
  notes: string | null;
};

export function listMockPeriodPayOverrides(
  companyId: string,
  filters?: { payPeriodId?: string; employeeId?: string },
): PeriodPayOverride[] {
  return getStore().periodPayOverrides.filter((o) => {
    if (o.companyId !== companyId) return false;
    if (filters?.payPeriodId && o.payPeriodId !== filters.payPeriodId) return false;
    if (filters?.employeeId && o.employeeId !== filters.employeeId) return false;
    return true;
  });
}

export function getMockPeriodPayOverride(
  companyId: string,
  employeeId: string,
  payPeriodId: string,
): PeriodPayOverride | undefined {
  return getStore().periodPayOverrides.find(
    (o) =>
      o.companyId === companyId &&
      o.employeeId === employeeId &&
      o.payPeriodId === payPeriodId,
  );
}

export function upsertMockPeriodPayOverride(
  companyId: string,
  input: UpsertPeriodPayOverrideInput,
): PeriodPayOverride {
  const store = getStore();
  const existing = store.periodPayOverrides.find(
    (o) =>
      o.companyId === companyId &&
      o.employeeId === input.employeeId &&
      o.payPeriodId === input.payPeriodId,
  );
  if (existing) {
    existing.grossAmount = input.grossAmount;
    existing.notes = input.notes;
    existing.updatedAt = new Date();
    return existing;
  }
  const now = new Date();
  const row: PeriodPayOverride = {
    id: randomUUID(),
    companyId,
    employeeId: input.employeeId,
    payPeriodId: input.payPeriodId,
    grossAmount: input.grossAmount,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  store.periodPayOverrides.push(row);
  return row;
}

export function deleteMockPeriodPayOverride(
  companyId: string,
  employeeId: string,
  payPeriodId: string,
): PeriodPayOverride | undefined {
  const store = getStore();
  const idx = store.periodPayOverrides.findIndex(
    (o) =>
      o.companyId === companyId &&
      o.employeeId === employeeId &&
      o.payPeriodId === payPeriodId,
  );
  if (idx === -1) return undefined;
  const [removed] = store.periodPayOverrides.splice(idx, 1);
  return removed;
}

// =====================================================================
// Paystub adjustments (payroll Phase 4.10) — per-employee, per-period
// line items: deductions / reimbursements / per-diem / expenses.
// =====================================================================

export type CreatePaystubAdjustmentInput = {
  employeeId: string;
  payPeriodId: string;
  type: string;
  amount: string;
  description: string | null;
};

export function listMockPaystubAdjustments(
  companyId: string,
  filters?: { payPeriodId?: string; employeeId?: string },
): PaystubAdjustment[] {
  return getStore().paystubAdjustments.filter((a) => {
    if (a.companyId !== companyId) return false;
    if (filters?.payPeriodId && a.payPeriodId !== filters.payPeriodId) return false;
    if (filters?.employeeId && a.employeeId !== filters.employeeId) return false;
    return true;
  });
}

export function createMockPaystubAdjustment(
  companyId: string,
  input: CreatePaystubAdjustmentInput,
): PaystubAdjustment {
  const now = new Date();
  const row: PaystubAdjustment = {
    id: randomUUID(),
    companyId,
    employeeId: input.employeeId,
    payPeriodId: input.payPeriodId,
    type: input.type,
    amount: input.amount,
    description: input.description,
    createdAt: now,
    updatedAt: now,
  };
  getStore().paystubAdjustments.push(row);
  return row;
}

export function deleteMockPaystubAdjustment(
  companyId: string,
  id: string,
): PaystubAdjustment | undefined {
  const store = getStore();
  const idx = store.paystubAdjustments.findIndex(
    (a) => a.companyId === companyId && a.id === id,
  );
  if (idx === -1) return undefined;
  const [removed] = store.paystubAdjustments.splice(idx, 1);
  return removed;
}

// =====================================================================
// Subcontractor payments (payroll Phase 4)
// =====================================================================

export type CreateSubcontractorPaymentInput = Omit<
  SubcontractorPayment,
  'id' | 'companyId' | 'createdAt' | 'updatedAt'
>;

export function listMockSubcontractorPayments(
  companyId: string,
  filters?: {
    vendorId?: string;
    projectId?: string;
    status?: string;
    overlapsStart?: string;
    overlapsEnd?: string;
  },
): SubcontractorPayment[] {
  return getStore()
    .subcontractorPayments.filter((s) => {
      if (s.companyId !== companyId) return false;
      if (filters?.vendorId && s.vendorId !== filters.vendorId) return false;
      if (filters?.projectId && s.projectId !== filters.projectId) return false;
      if (filters?.status && s.status !== filters.status) return false;
      // Overlap test: payment's work period overlaps [overlapsStart, overlapsEnd].
      if (filters?.overlapsStart && filters?.overlapsEnd) {
        if (s.workPeriodEnd < filters.overlapsStart) return false;
        if (s.workPeriodStart > filters.overlapsEnd) return false;
      }
      return true;
    })
    .sort((a, b) => (a.workPeriodStart < b.workPeriodStart ? 1 : -1));
}

export function getMockSubcontractorPayment(
  companyId: string,
  id: string,
): SubcontractorPayment | undefined {
  return getStore().subcontractorPayments.find(
    (s) => s.id === id && s.companyId === companyId,
  );
}

export function createMockSubcontractorPayment(
  companyId: string,
  input: CreateSubcontractorPaymentInput,
): SubcontractorPayment {
  const store = getStore();
  const now = new Date();
  const payment: SubcontractorPayment = {
    id: randomUUID(),
    companyId,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  store.subcontractorPayments.push(payment);
  return payment;
}

export function updateMockSubcontractorPayment(
  companyId: string,
  id: string,
  patch: Partial<
    Omit<SubcontractorPayment, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>
  >,
): SubcontractorPayment | undefined {
  const store = getStore();
  const p = store.subcontractorPayments.find(
    (x) => x.id === id && x.companyId === companyId,
  );
  if (!p) return undefined;
  Object.assign(p, patch, { updatedAt: new Date() });
  return p;
}

export function deleteMockSubcontractorPayment(
  companyId: string,
  id: string,
): SubcontractorPayment | undefined {
  const store = getStore();
  const idx = store.subcontractorPayments.findIndex(
    (s) => s.id === id && s.companyId === companyId,
  );
  if (idx === -1) return undefined;
  const [removed] = store.subcontractorPayments.splice(idx, 1);
  return removed;
}

// =====================================================================
// Period paystub snapshots (payroll Phase 4.9 — lock & post)
// =====================================================================

export type CreateSnapshotInput = Omit<
  PeriodPaystubSnapshot,
  'id' | 'companyId' | 'snapshottedAt'
>;

export function listMockPaystubSnapshots(
  companyId: string,
  filters?: { payPeriodId?: string },
): PeriodPaystubSnapshot[] {
  return getStore().periodPaystubSnapshots.filter((s) => {
    if (s.companyId !== companyId) return false;
    if (filters?.payPeriodId && s.payPeriodId !== filters.payPeriodId) {
      return false;
    }
    return true;
  });
}

/** Atomic "replace all snapshots for this period" — used when locking. */
export function replaceMockPaystubSnapshotsForPeriod(
  companyId: string,
  payPeriodId: string,
  inputs: CreateSnapshotInput[],
): PeriodPaystubSnapshot[] {
  const store = getStore();
  // Drop any existing snapshots for this period — locking always
  // rewrites the full set.
  store.periodPaystubSnapshots = store.periodPaystubSnapshots.filter(
    (s) => !(s.companyId === companyId && s.payPeriodId === payPeriodId),
  );
  const now = new Date();
  const inserted: PeriodPaystubSnapshot[] = inputs.map((input) => ({
    id: randomUUID(),
    companyId,
    snapshottedAt: now,
    ...input,
  }));
  store.periodPaystubSnapshots.push(...inserted);
  return inserted;
}

/** Atomic "drop all snapshots for this period" — used when unlocking. */
export function deleteMockPaystubSnapshotsForPeriod(
  companyId: string,
  payPeriodId: string,
): number {
  const store = getStore();
  const before = store.periodPaystubSnapshots.length;
  store.periodPaystubSnapshots = store.periodPaystubSnapshots.filter(
    (s) => !(s.companyId === companyId && s.payPeriodId === payPeriodId),
  );
  return before - store.periodPaystubSnapshots.length;
}
