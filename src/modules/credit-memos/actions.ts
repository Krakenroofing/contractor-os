'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  applyCreditMemoToInvoice,
  createCreditMemo,
  getCreditMemo,
  refundCreditMemo,
  unapplyCreditMemoApplication,
  updateCreditMemo,
  voidCreditMemo,
} from '@/lib/data/credit-memos';
import { createDeductChangeOrderForRefund } from '@/lib/data/change-orders';
import {
  closedPeriodMessageFor,
  periodClosedMessage,
} from '@/lib/data/accounting-periods';

// ---------- Issue ----------

const issueSchema = z.object({
  customerId: z.string().uuid('Pick a customer'),
  projectId: z.string().uuid().optional().or(z.literal('')),
  invoiceId: z.string().uuid().optional().or(z.literal('')),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date'),
  amount: z
    .string()
    .refine(
      (v) => Number.isFinite(Number(v)) && Number(v) > 0,
      'Amount must be a positive number',
    ),
  reason: z.string().min(1, 'Reason is required').max(500),
  notes: z.string().max(2000).optional().or(z.literal('')),
  // Mode = how to consume the credit right after issuance. 'open' leaves
  // it sitting on the customer's balance for future use.
  mode: z.enum(['apply_to_invoice', 'refund_cash', 'open']),
  // refund_cash:
  refundBankAccount: z.string().max(120).optional().or(z.literal('')),
  refundReference: z.string().max(120).optional().or(z.literal('')),
  // refund_cash + a project in scope: also book a deduct change order that
  // lowers the project's revised contract by the refund, and net the refund
  // out of billed-net in reporting. Checkbox sends 'on' when checked.
  recordAsContractReduction: z
    .union([z.literal('on'), z.literal('')])
    .optional(),
});

export type IssueCreditMemoState = {
  errors?: Record<string, string[]>;
  formError?: string;
  okCreditId?: string;
  // When a deduct CO was auto-created, surface it so the dialog can confirm
  // the contract reduction instead of nudging the operator to make one.
  deductCONumber?: string;
  deductCOId?: string;
};

export async function issueCreditMemoAction(
  _prev: IssueCreditMemoState,
  formData: FormData,
): Promise<IssueCreditMemoState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  // Credit memos affect AR — gate by the invoices resource.
  if (!canCreate(role, 'invoices')) {
    return { formError: 'You do not have permission to issue credit memos.' };
  }

  const parsed = issueSchema.safeParse({
    customerId: formData.get('customerId'),
    projectId: formData.get('projectId') ?? '',
    invoiceId: formData.get('invoiceId') ?? '',
    issueDate: formData.get('issueDate'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
    notes: formData.get('notes') ?? '',
    mode: formData.get('mode') ?? 'open',
    refundBankAccount: formData.get('refundBankAccount') ?? '',
    refundReference: formData.get('refundReference') ?? '',
    recordAsContractReduction: formData.get('recordAsContractReduction') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  if (data.mode === 'apply_to_invoice' && !data.invoiceId) {
    return {
      errors: {
        invoiceId: ['Pick an invoice when "Apply to this invoice" is selected.'],
      },
    };
  }

  const companyId = await getActiveCompanyId();
  const amountNum = Number(data.amount);
  const projectId =
    data.projectId && data.projectId !== '' ? data.projectId : null;
  // Only refunds against a project can be booked as a contract reduction.
  const reduceContract =
    data.recordAsContractReduction === 'on' &&
    data.mode === 'refund_cash' &&
    !!projectId;

  // Create the credit memo (status=issued), then in the same flow either
  // apply it to the invoice or refund it. 'open' mode skips the second
  // step — credit sits available on the customer. When the refund is a
  // contract reduction, book the deduct CO first so we can link it.
  let createdId: string;
  let deductCONumber: string | undefined;
  let deductCOId: string | undefined;
  try {
    let changeOrderId: string | null = null;
    if (reduceContract && projectId) {
      // The refund amount is GROSS (base + VAT being handed back), but a
      // contract is stored NET — so the deduct CO must reduce the contract by
      // the NET portion only. De-VAT using the company rate (factor 1 when not
      // VAT-active). The credit memo itself stays gross; reporting de-VATs it
      // when netting out of billed (getContractReductionRefundByProjectMap).
      const company = await getActiveCompany();
      const vatFactor = company.isVatActive
        ? 1 + Number(company.vatRatePercent) / 100
        : 1;
      const netAmount = Math.round((amountNum / vatFactor) * 100) / 100;
      const co = await createDeductChangeOrderForRefund(companyId, {
        projectId,
        amount: netAmount,
        issueDate: data.issueDate,
        description: `Deduct CO — refund of canceled/reduced scope. ${data.reason}`,
      });
      changeOrderId = co.id;
      deductCONumber = co.number;
      deductCOId = co.id;
    }

    const cm = await createCreditMemo(companyId, {
      customerId: data.customerId,
      projectId,
      invoiceId: data.invoiceId && data.invoiceId !== '' ? data.invoiceId : null,
      issueDate: data.issueDate,
      amount: amountNum,
      reason: data.reason,
      notes: data.notes?.trim() || null,
      createdByUserId: user.id,
      changeOrderId,
    });
    createdId = cm.id;

    if (data.mode === 'apply_to_invoice' && data.invoiceId) {
      await applyCreditMemoToInvoice(companyId, cm.id, {
        appliedAt: data.issueDate,
        amount: amountNum,
        invoiceId: data.invoiceId,
        notes: null,
        createdByUserId: user.id,
      });
    } else if (data.mode === 'refund_cash') {
      await refundCreditMemo(companyId, cm.id, {
        appliedAt: data.issueDate,
        amount: amountNum,
        bankAccount: data.refundBankAccount?.trim() || null,
        reference: data.refundReference?.trim() || null,
        notes: null,
        createdByUserId: user.id,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to issue credit memo: ${message}` };
  }

  revalidatePath('/invoices');
  revalidatePath('/customers');
  revalidatePath('/dashboard');
  revalidatePath('/reports/accounts-receivable');
  revalidatePath('/reports/customer-summary');
  revalidatePath('/change-orders');
  if (data.invoiceId) revalidatePath(`/invoices/${data.invoiceId}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/customers/${data.customerId}`);
  return { okCreditId: createdId, deductCONumber, deductCOId };
}

// ---------- Edit details ----------

const editSchema = z.object({
  creditMemoId: z.string().uuid('Invalid credit memo id'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date'),
  amount: z
    .string()
    .refine(
      (v) => Number.isFinite(Number(v)) && Number(v) > 0,
      'Amount must be positive',
    ),
  reason: z.string().min(1, 'Reason is required').max(500),
  notes: z.string().max(2000).optional().or(z.literal('')),
  invoiceId: z.string().uuid().optional().or(z.literal('')),
});

export async function updateCreditMemoAction(
  _prev: ApplyCreditState,
  formData: FormData,
): Promise<ApplyCreditState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'No permission to edit credit memos.' };
  }
  const parsed = editSchema.safeParse({
    creditMemoId: formData.get('creditMemoId'),
    issueDate: formData.get('issueDate'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
    notes: formData.get('notes') ?? '',
    invoiceId: formData.get('invoiceId') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const companyId = await getActiveCompanyId();
  const existing = await getCreditMemo(companyId, parsed.data.creditMemoId);
  if (!existing) return { formError: 'Credit memo not found.' };
  // Issued credit memos are final on the figures that hit revenue and AR:
  // amount and date change only through Void & reissue.
  if (
    Number(parsed.data.amount).toFixed(2) !== Number(existing.amount).toFixed(2) ||
    parsed.data.issueDate !== String(existing.issueDate)
  ) {
    return {
      formError:
        'An issued credit memo’s amount and date are final. Use “Void & reissue” to replace it with the corrected figures.',
    };
  }
  try {
    await updateCreditMemo(companyId, parsed.data.creditMemoId, {
      reason: parsed.data.reason,
      notes: parsed.data.notes?.trim() || null,
      invoiceId: parsed.data.invoiceId || null,
    });
  } catch (err) {
    return {
      formError: err instanceof Error ? err.message : 'Could not save changes.',
    };
  }
  revalidatePath(`/credit-memos/${parsed.data.creditMemoId}`);
  revalidatePath('/invoices');
  revalidatePath('/customers');
  revalidatePath('/reports/accounts-receivable');
  if (existing.invoiceId) revalidatePath(`/invoices/${existing.invoiceId}`);
  if (parsed.data.invoiceId) revalidatePath(`/invoices/${parsed.data.invoiceId}`);
  return { ok: true };
}

// ---------- Apply to an existing invoice (later) ----------

const applySchema = z.object({
  creditMemoId: z.string().uuid('Invalid credit memo id'),
  invoiceId: z.string().uuid('Pick an invoice'),
  appliedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date'),
  amount: z
    .string()
    .refine(
      (v) => Number.isFinite(Number(v)) && Number(v) > 0,
      'Amount must be positive',
    ),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type ApplyCreditState = {
  errors?: Record<string, string[]>;
  formError?: string;
  ok?: boolean;
};

export async function applyCreditToInvoiceAction(
  _prev: ApplyCreditState,
  formData: FormData,
): Promise<ApplyCreditState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'No permission to apply credits.' };
  }
  const parsed = applySchema.safeParse({
    creditMemoId: formData.get('creditMemoId'),
    invoiceId: formData.get('invoiceId'),
    appliedAt: formData.get('appliedAt'),
    amount: formData.get('amount'),
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const companyId = await getActiveCompanyId();
  try {
    await applyCreditMemoToInvoice(companyId, parsed.data.creditMemoId, {
      appliedAt: parsed.data.appliedAt,
      amount: Number(parsed.data.amount),
      invoiceId: parsed.data.invoiceId,
      notes: parsed.data.notes?.trim() || null,
      createdByUserId: user.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: message };
  }
  revalidatePath('/invoices');
  revalidatePath('/customers');
  revalidatePath(`/invoices/${parsed.data.invoiceId}`);
  revalidatePath('/reports/accounts-receivable');
  return { ok: true };
}

// ---------- Refund cash (later) ----------

const refundSchema = z.object({
  creditMemoId: z.string().uuid('Invalid credit memo id'),
  appliedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date'),
  amount: z
    .string()
    .refine(
      (v) => Number.isFinite(Number(v)) && Number(v) > 0,
      'Amount must be positive',
    ),
  bankAccount: z.string().max(120).optional().or(z.literal('')),
  reference: z.string().max(120).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function refundCreditMemoAction(
  _prev: ApplyCreditState,
  formData: FormData,
): Promise<ApplyCreditState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'No permission to refund credits.' };
  }
  const parsed = refundSchema.safeParse({
    creditMemoId: formData.get('creditMemoId'),
    appliedAt: formData.get('appliedAt'),
    amount: formData.get('amount'),
    bankAccount: formData.get('bankAccount') ?? '',
    reference: formData.get('reference') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const companyId = await getActiveCompanyId();
  try {
    await refundCreditMemo(companyId, parsed.data.creditMemoId, {
      appliedAt: parsed.data.appliedAt,
      amount: Number(parsed.data.amount),
      bankAccount: parsed.data.bankAccount?.trim() || null,
      reference: parsed.data.reference?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      createdByUserId: user.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: message };
  }
  revalidatePath('/invoices');
  revalidatePath('/customers');
  revalidatePath('/dashboard');
  return { ok: true };
}

// ---------- Unapply a single application ----------

const unapplySchema = z.object({
  applicationId: z.string().uuid('Invalid application id'),
});

export async function unapplyCreditMemoApplicationAction(
  _prev: ApplyCreditState,
  formData: FormData,
): Promise<ApplyCreditState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'No permission to unapply credits.' };
  }
  const parsed = unapplySchema.safeParse({
    applicationId: formData.get('applicationId'),
  });
  if (!parsed.success) return { formError: 'Invalid id.' };
  const companyId = await getActiveCompanyId();
  try {
    const { creditMemoId } = await unapplyCreditMemoApplication(
      companyId,
      parsed.data.applicationId,
    );
    revalidatePath(`/credit-memos/${creditMemoId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: message };
  }
  revalidatePath('/invoices');
  revalidatePath('/customers');
  revalidatePath('/dashboard');
  revalidatePath('/reports/accounts-receivable');
  return { ok: true };
}

// ---------- Void ----------

const voidSchema = z.object({
  id: z.string().uuid('Invalid credit memo id'),
});

export async function voidCreditMemoAction(
  _prev: ApplyCreditState,
  formData: FormData,
): Promise<ApplyCreditState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'No permission to void credits.' };
  }
  const parsed = voidSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { formError: 'Invalid id.' };
  const companyId = await getActiveCompanyId();
  try {
    await voidCreditMemo(companyId, parsed.data.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: message };
  }
  revalidatePath('/invoices');
  revalidatePath('/customers');
  return { ok: true };
}

// ---------- Void & reissue ----------

const reissueSchema = z.object({
  id: z.string().uuid('Invalid credit memo id'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date'),
  amount: z
    .string()
    .refine(
      (v) => Number.isFinite(Number(v)) && Number(v) > 0,
      'Amount must be positive',
    ),
  reason: z.string().min(1, 'Reason is required').max(500),
});

export type ReissueCreditState = ApplyCreditState & { newId?: string };

/** The correction path for an issued credit memo: void it (it keeps its
 *  number, on record as void) and issue a replacement with the corrected
 *  amount / date under the next number. Unapplied credits only. */
export async function voidAndReissueCreditMemoAction(
  _prev: ReissueCreditState,
  formData: FormData,
): Promise<ReissueCreditState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'No permission to reissue credits.' };
  }
  const parsed = reissueSchema.safeParse({
    id: formData.get('id'),
    issueDate: formData.get('issueDate'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const companyId = await getActiveCompanyId();
  const cm = await getCreditMemo(companyId, parsed.data.id);
  if (!cm) return { formError: 'Credit memo not found.' };
  if (cm.status === 'void') return { formError: 'This credit memo is already void.' };
  if (Number(cm.appliedAmount) > 0.005) {
    return {
      formError:
        'This credit has been applied or refunded — unapply those first, then void & reissue.',
    };
  }
  if (cm.changeOrderId) {
    return {
      formError:
        'This credit booked a deduct change order for its amount — void the change order and this credit, then issue a new one.',
    };
  }
  const closedMsg = await closedPeriodMessageFor(
    companyId,
    [String(cm.issueDate), parsed.data.issueDate],
    'This credit memo',
  );
  if (closedMsg) return { formError: closedMsg };

  let newId: string;
  try {
    await voidCreditMemo(companyId, cm.id);
    const replacement = await createCreditMemo(companyId, {
      customerId: cm.customerId,
      projectId: cm.projectId,
      invoiceId: cm.invoiceId,
      issueDate: parsed.data.issueDate,
      amount: Number(parsed.data.amount),
      reason: parsed.data.reason,
      notes: [cm.notes, `Replaces ${cm.number} (voided).`]
        .filter(Boolean)
        .join('\n'),
      createdByUserId: user.id,
      changeOrderId: null,
    });
    newId = replacement.id;
  } catch (err) {
    return {
      formError:
        periodClosedMessage(err) ??
        (err instanceof Error ? err.message : 'Could not reissue the credit.'),
    };
  }
  revalidatePath('/invoices');
  revalidatePath('/customers');
  revalidatePath('/reports/accounts-receivable');
  revalidatePath(`/credit-memos/${cm.id}`);
  if (cm.invoiceId) revalidatePath(`/invoices/${cm.invoiceId}`);
  return { ok: true, newId };
}

// Suppress unused-import linter for redirect in case we add a redirect
// path later (e.g., to a dedicated /credit-memos/<id> page).
void redirect;
