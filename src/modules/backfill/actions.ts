'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  add,
  multiply,
  percent,
  parseMoney,
  subtract,
  toMoneyString,
  toPercentString,
  toQuantityString,
} from '@/lib/money';
import {
  createCustomer,
  type CreateCustomerInput,
} from '@/lib/data/customers';
import { createProject } from '@/lib/data/projects';
import {
  createEstimate,
  DuplicateEstimateNumberError,
} from '@/lib/data/estimates';
import {
  createProposal,
  DuplicateProposalNumberError,
} from '@/lib/data/proposals';
import {
  createChangeOrder,
  DuplicateChangeOrderNumberError,
} from '@/lib/data/change-orders';
import {
  createInvoice,
  DuplicateInvoiceNumberError,
} from '@/lib/data/invoices';
import {
  createPayment,
  DuplicatePaymentNumberError,
} from '@/lib/data/invoice-payments';
import {
  createPurchaseOrder,
  DuplicatePONumberError,
} from '@/lib/data/purchase-orders';
import {
  createRetainageRelease,
  DuplicateRetainageReleaseNumberError,
  RetainageOverReleaseError,
} from '@/lib/data/retainage-releases';
import { getInvoice } from '@/lib/data/invoices';

// Backfill-specific server actions. Differences vs. the canonical /new
// actions:
//   - All accept explicit historical dates; nothing defaults to "today".
//   - On success they DO NOT redirect — the caller stays on the wizard step
//     so the operator can keep entering more records of the same kind.
//   - Validation and FK checks reuse the data-layer creators, so DB / demo
//     dispatch happens for free.

export type BackfillState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

const numericString = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Must be a non-negative number',
  });

const positiveAmount = z
  .string()
  .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) > 0, {
    message: 'Amount must be greater than zero',
  });

function gateCreate(role: Awaited<ReturnType<typeof getActiveRole>>, formError = 'Not allowed') {
  return canCreate(role, 'backfill') ? null : { formError };
}

// =====================================================================
// Step 1 — Customers
// =====================================================================

const customerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  customerType: z.enum(['residential', 'commercial']).default('residential'),
  primaryContactName: z.string().max(200).optional().or(z.literal('')),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().max(40).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function backfillCustomerAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = customerSchema.safeParse({
    name: formData.get('name'),
    customerType: formData.get('customerType') ?? 'residential',
    primaryContactName: formData.get('primaryContactName') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const input: CreateCustomerInput = {
    name: data.name,
    customerType: data.customerType,
    primaryContactName: emptyToNull(data.primaryContactName ?? null),
    email: emptyToNull(data.email ?? null),
    phone: emptyToNull(data.phone ?? null),
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingCity: null,
    billingState: null,
    billingPostalCode: null,
    tinNumber: null,
    notes: emptyToNull(data.notes ?? null),
  };

  try {
    await createCustomer(companyId, input);
  } catch (err) {
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/customers');
  return { ok: true };
}

// =====================================================================
// Step 2 — Projects
// =====================================================================

const projectSchema = z.object({
  customerId: z.string().uuid('Pick a customer'),
  name: z.string().min(1, 'Project name is required').max(200),
  status: z.enum(['lead', 'estimating', 'won', 'in_progress', 'closed', 'lost']),
  startDate: z.string().min(1, 'Start date required for backfill'),
  targetCompletionDate: z.string().optional().or(z.literal('')),
  contractValue: numericString,
});

export async function backfillProjectAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = projectSchema.safeParse({
    customerId: formData.get('customerId'),
    name: formData.get('name'),
    status: formData.get('status') ?? 'in_progress',
    startDate: formData.get('startDate'),
    targetCompletionDate: formData.get('targetCompletionDate') ?? '',
    contractValue: formData.get('contractValue') ?? '0',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  try {
    await createProject(companyId, {
      customerId: data.customerId,
      name: data.name,
      status: data.status,
      jobsiteAddressLine1: null,
      jobsiteAddressLine2: null,
      jobsiteCity: null,
      jobsiteState: null,
      jobsitePostalCode: null,
      projectManagerId: null,
      estimatorId: null,
      startDate: data.startDate,
      targetCompletionDate: emptyToNull(data.targetCompletionDate ?? null),
      actualCompletionDate: null,
      contractValue: data.contractValue,
      originalContractValue: data.contractValue,
      totalChangeOrders: '0',
      currentBudget: data.contractValue,
      notes: null,
    });
  } catch (err) {
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/projects');
  revalidatePath('/projects');
  return { ok: true };
}

// =====================================================================
// Step 3 — Contracts / Proposals (creates an estimate + proposal in one shot)
// =====================================================================

const proposalSchema = z.object({
  projectId: z.string().uuid('Pick a project'),
  estimateNumber: z.string().min(1, 'Estimate number required').max(50),
  proposalNumber: z.string().min(1, 'Proposal number required').max(50),
  proposalDate: z.string().min(1, 'Proposal date required'),
  expiryDate: z.string().optional().or(z.literal('')),
  total: positiveAmount,
  status: z.enum(['draft', 'sent', 'approved', 'rejected', 'expired']),
  scopeOfWork: z.string().max(8000).optional().or(z.literal('')),
});

export async function backfillProposalAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = proposalSchema.safeParse({
    projectId: formData.get('projectId'),
    estimateNumber: formData.get('estimateNumber'),
    proposalNumber: formData.get('proposalNumber'),
    proposalDate: formData.get('proposalDate'),
    expiryDate: formData.get('expiryDate') ?? '',
    total: formData.get('total') ?? '0',
    status: formData.get('status') ?? 'sent',
    scopeOfWork: formData.get('scopeOfWork') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const totalNum = Number(data.total);
  const totalStr = toMoneyString(totalNum);

  try {
    // Lump-sum estimate so the proposal has a parent.
    const estimate = await createEstimate(companyId, {
      number: data.estimateNumber,
      projectId: data.projectId,
      status: data.status === 'approved' ? 'approved' : 'internal_review',
      validUntil: emptyToNull(data.expiryDate ?? null),
      lines: [
        {
          costCodeId: '',
          description: `Backfilled scope (lump sum) — proposal ${data.proposalNumber}`,
          unit: 'lot',
          quantity: '1',
          unitCost: totalStr,
          markupPercent: '0',
          lineTotal: totalStr,
        },
      ],
      subtotal: totalStr,
      total: totalStr,
    });

    await createProposal(companyId, {
      number: data.proposalNumber,
      projectId: data.projectId,
      estimateId: estimate.id,
      total: totalStr,
      status: data.status,
      proposalDate: data.proposalDate,
      expiryDate: emptyToNull(data.expiryDate ?? null),
      scopeOfWork: emptyToNull(data.scopeOfWork ?? null),
      inclusions: null,
      exclusions: null,
      paymentSchedule: null,
      warrantyNotes: null,
      termsAndConditions: null,
    });
  } catch (err) {
    if (err instanceof DuplicateEstimateNumberError) {
      return { errors: { estimateNumber: ['Already used'] } };
    }
    if (err instanceof DuplicateProposalNumberError) {
      return { errors: { proposalNumber: ['Already used'] } };
    }
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/proposals');
  return { ok: true };
}

// =====================================================================
// Step 4 — Change Orders (lump-sum, status-aware)
// =====================================================================

const changeOrderSchema = z.object({
  projectId: z.string().uuid('Pick a project'),
  number: z.string().min(1, 'CO number required').max(50),
  description: z.string().min(1, 'Scope description required').max(4000),
  reason: z.enum([
    'scope_change',
    'customer_request',
    'design_change',
    'conditions',
    'other',
  ]),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
  submittedAt: z.string().optional().or(z.literal('')),
  approvedAt: z.string().optional().or(z.literal('')),
  total: positiveAmount,
  scheduleImpactDays: z
    .string()
    .refine((v) => !Number.isNaN(Number(v)), 'Must be a number')
    .transform((v) => Number(v)),
});

export async function backfillChangeOrderAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = changeOrderSchema.safeParse({
    projectId: formData.get('projectId'),
    number: formData.get('number'),
    description: formData.get('description'),
    reason: formData.get('reason') ?? 'scope_change',
    status: formData.get('status') ?? 'submitted',
    submittedAt: formData.get('submittedAt') ?? '',
    approvedAt: formData.get('approvedAt') ?? '',
    total: formData.get('total') ?? '0',
    scheduleImpactDays: formData.get('scheduleImpactDays') ?? '0',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const totalNum = Number(data.total);
  const totalStr = toMoneyString(totalNum);

  try {
    await createChangeOrder(companyId, {
      number: data.number,
      projectId: data.projectId,
      proposalId: null,
      status: data.status,
      reason: data.reason,
      description: data.description,
      scheduleImpactDays: data.scheduleImpactDays,
      submittedAt: emptyToNull(data.submittedAt ?? null),
      approvedAt: emptyToNull(data.approvedAt ?? null),
      customerSignedName: null,
      subtotal: totalStr,
      total: totalStr,
      lines: [
        {
          costCodeId: '',
          description: `Backfilled CO ${data.number} (lump sum)`,
          unit: 'lot',
          quantity: '1',
          unitCost: totalStr,
          markupPercent: '0',
          lineTotal: totalStr,
        },
      ],
    });
  } catch (err) {
    if (err instanceof DuplicateChangeOrderNumberError) {
      return { errors: { number: ['Already used'] } };
    }
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/change-orders');
  revalidatePath('/projects');
  return { ok: true };
}

// =====================================================================
// Step 5 — Invoices (lump-sum, with retainage)
// =====================================================================

const invoiceSchema = z.object({
  projectId: z.string().uuid('Pick a project'),
  number: z.string().min(1, 'Invoice number required').max(50),
  status: z.enum(['draft', 'sent', 'partial', 'paid']),
  invoiceDate: z.string().min(1, 'Invoice date required'),
  dueDate: z.string().optional().or(z.literal('')),
  subtotal: positiveAmount,
  taxAmount: numericString,
  retainagePercent: numericString.optional().or(z.literal('')),
  expectedRetainageReleaseDate: z.string().optional().or(z.literal('')),
  description: z.string().max(500).optional().or(z.literal('')),
});

export async function backfillInvoiceAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = invoiceSchema.safeParse({
    projectId: formData.get('projectId'),
    number: formData.get('number'),
    status: formData.get('status') ?? 'sent',
    invoiceDate: formData.get('invoiceDate'),
    dueDate: formData.get('dueDate') ?? '',
    subtotal: formData.get('subtotal') ?? '0',
    taxAmount: formData.get('taxAmount') ?? '0',
    retainagePercent: formData.get('retainagePercent') ?? '',
    expectedRetainageReleaseDate: formData.get('expectedRetainageReleaseDate') ?? '',
    description: formData.get('description') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const subtotal = Number(data.subtotal);
  const tax = Number(data.taxAmount);
  const pctRaw = data.retainagePercent ?? '';
  const pct = pctRaw === '' ? 0 : Number(pctRaw);
  const retainage = pct > 0 ? percent(subtotal, pct) : 0;
  const total = subtract(add(subtotal, tax), retainage);

  try {
    await createInvoice(companyId, {
      number: data.number,
      projectId: data.projectId,
      proposalId: null,
      changeOrderId: null,
      templateId: null,
      status: data.status,
      billingType: 'progress',
      invoiceDate: data.invoiceDate,
      dueDate: emptyToNull(data.dueDate ?? null),
      subtotal: toMoneyString(subtotal),
      taxAmount: toMoneyString(tax),
      retainagePercent: toPercentString(pct),
      retainageAmount: toMoneyString(retainage),
      retainageReleased: '0.00',
      expectedRetainageReleaseDate: emptyToNull(
        data.expectedRetainageReleaseDate ?? null,
      ),
      total: toMoneyString(total),
      amountPaid: '0.00',
      notes: null,
      termsOverride: null,
      lines: [
        {
          costCodeId: null,
          description:
            (data.description && data.description !== ''
              ? data.description
              : `Backfilled invoice ${data.number}`) as string,
          unit: 'lot',
          quantity: toQuantityString(1),
          unitCost: toQuantityString(subtotal),
          lineTotal: toMoneyString(subtotal),
        },
      ],
    });
  } catch (err) {
    if (err instanceof DuplicateInvoiceNumberError) {
      return { errors: { number: ['Already used'] } };
    }
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/invoices');
  revalidatePath('/invoices');
  if (retainage > 0) revalidatePath('/retainage');
  return { ok: true };
}

// =====================================================================
// Step 6 — Payments
// =====================================================================

const paymentSchema = z.object({
  paymentNumber: z.string().min(1, 'Payment number required').max(50),
  invoiceId: z.string().uuid('Pick an invoice'),
  paidDate: z.string().min(1, 'Payment date required'),
  amount: positiveAmount,
  method: z.enum(['ach', 'wire', 'check', 'credit_card', 'cash', 'other']),
  reference: z.string().max(100).optional().or(z.literal('')),
  bankAccount: z.string().max(100).optional().or(z.literal('')),
  status: z.enum(['pending', 'received', 'applied', 'returned']),
});

export async function backfillPaymentAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = paymentSchema.safeParse({
    paymentNumber: formData.get('paymentNumber'),
    invoiceId: formData.get('invoiceId'),
    paidDate: formData.get('paidDate'),
    amount: formData.get('amount') ?? '0',
    method: formData.get('method') ?? 'ach',
    reference: formData.get('reference') ?? '',
    bankAccount: formData.get('bankAccount') ?? '',
    status: formData.get('status') ?? 'applied',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  // Validate invoice belongs to active company before recording payment.
  const inv = await getInvoice(companyId, data.invoiceId);
  if (!inv) {
    return { errors: { invoiceId: ['Invoice not found in active company'] } };
  }
  // Warn if the payment exceeds the remaining balance.
  const balance = subtract(parseMoney(inv.total), parseMoney(inv.amountPaid));
  if (Number(data.amount) > balance + 0.005 && data.status !== 'returned') {
    return {
      errors: {
        amount: [
          `Exceeds invoice balance of ${balance.toFixed(2)}. Mark "Returned" if intentional.`,
        ],
      },
    };
  }

  try {
    await createPayment(companyId, {
      invoiceId: data.invoiceId,
      paymentNumber: data.paymentNumber,
      paidDate: data.paidDate,
      amount: toMoneyString(Number(data.amount)),
      method: data.method,
      reference: emptyToNull(data.reference ?? null),
      bankAccount: emptyToNull(data.bankAccount ?? null),
      status: data.status,
      notes: null,
    });
  } catch (err) {
    if (err instanceof DuplicatePaymentNumberError) {
      return { errors: { paymentNumber: ['Already used'] } };
    }
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/payments');
  revalidatePath('/payments');
  revalidatePath('/invoices');
  revalidatePath('/accounts-receivable');
  return { ok: true };
}

// =====================================================================
// Step 7 — Purchase Orders (lump-sum)
// =====================================================================

const purchaseOrderSchema = z.object({
  number: z.string().min(1, 'PO number required').max(50),
  projectId: z.string().uuid('Pick a project'),
  vendorId: z.string().uuid('Pick a vendor'),
  status: z.enum([
    'draft',
    'issued',
    'partially_received',
    'received',
    'closed',
  ]),
  issueDate: z.string().min(1, 'Issue date required'),
  expectedDeliveryDate: z.string().optional().or(z.literal('')),
  subtotal: positiveAmount,
  taxAmount: numericString,
  shipping: numericString,
  description: z.string().max(500).optional().or(z.literal('')),
});

export async function backfillPurchaseOrderAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = purchaseOrderSchema.safeParse({
    number: formData.get('number'),
    projectId: formData.get('projectId'),
    vendorId: formData.get('vendorId'),
    status: formData.get('status') ?? 'issued',
    issueDate: formData.get('issueDate'),
    expectedDeliveryDate: formData.get('expectedDeliveryDate') ?? '',
    subtotal: formData.get('subtotal') ?? '0',
    taxAmount: formData.get('taxAmount') ?? '0',
    shipping: formData.get('shipping') ?? '0',
    description: formData.get('description') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const subtotal = Number(data.subtotal);
  const tax = Number(data.taxAmount);
  const shipping = Number(data.shipping);
  const total = add(add(subtotal, tax), shipping);

  try {
    await createPurchaseOrder(companyId, {
      number: data.number,
      projectId: data.projectId,
      vendorId: data.vendorId,
      landedCostEntryId: null,
      status: data.status,
      issueDate: data.issueDate,
      expectedDeliveryDate: emptyToNull(data.expectedDeliveryDate ?? null),
      notes: null,
      subtotal: toMoneyString(subtotal),
      taxAmount: toMoneyString(tax),
      shipping: toMoneyString(shipping),
      total: toMoneyString(total),
      lines: [
        {
          costCodeId: '',
          description:
            (data.description && data.description !== ''
              ? data.description
              : `Backfilled PO ${data.number}`) as string,
          unit: 'lot',
          quantityOrdered: '1',
          unitCost: toMoneyString(subtotal),
          lineTotal: toMoneyString(subtotal),
        },
      ],
    });
  } catch (err) {
    if (err instanceof DuplicatePONumberError) {
      return { errors: { number: ['Already used'] } };
    }
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/purchase-orders');
  revalidatePath('/purchase-orders');
  return { ok: true };
}

// =====================================================================
// Step 8 — Retainage releases
// =====================================================================

const retainageSchema = z.object({
  releaseNumber: z.string().min(1, 'Release number required').max(50),
  invoiceId: z.string().uuid('Pick an invoice'),
  releaseDate: z.string().min(1, 'Release date required'),
  amount: positiveAmount,
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function backfillRetainageAction(
  _prev: BackfillState,
  formData: FormData,
): Promise<BackfillState> {
  const role = await getActiveRole();
  const gate = gateCreate(role);
  if (gate) return gate;

  const parsed = retainageSchema.safeParse({
    releaseNumber: formData.get('releaseNumber'),
    invoiceId: formData.get('invoiceId'),
    releaseDate: formData.get('releaseDate'),
    amount: formData.get('amount') ?? '0',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  const inv = await getInvoice(companyId, data.invoiceId);
  if (!inv) {
    return { errors: { invoiceId: ['Invoice not found in active company'] } };
  }
  void multiply; // keep import for future calculator extensions

  try {
    await createRetainageRelease(companyId, {
      invoiceId: data.invoiceId,
      releaseNumber: data.releaseNumber,
      releaseDate: data.releaseDate,
      amount: toMoneyString(Number(data.amount)),
      paymentId: null,
      notes: emptyToNull(data.notes ?? null),
    });
  } catch (err) {
    if (err instanceof DuplicateRetainageReleaseNumberError) {
      return { errors: { releaseNumber: ['Already used'] } };
    }
    if (err instanceof RetainageOverReleaseError) {
      return { errors: { amount: [err.message] } };
    }
    return { formError: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/backfill');
  revalidatePath('/backfill/retainage');
  revalidatePath('/retainage');
  return { ok: true };
}
