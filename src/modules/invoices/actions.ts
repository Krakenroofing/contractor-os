'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  add,
  multiply,
  percent,
  subtract,
  toMoneyString,
  toPercentString,
  toQuantityString,
} from '@/lib/money';
import {
  createInvoice,
  deleteDraftInvoice,
  DuplicateInvoiceNumberError,
  getInvoice,
  updateInvoiceFull,
  updateInvoiceHeader,
} from '@/lib/data/invoices';
import { reconcileAllInvoices } from '@/lib/data/invoice-reconcile';
import { billingTypeValues, invoiceFormSchema } from './schema';

export type CreateInvoiceState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type UpdateInvoiceHeaderState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createInvoiceAction(
  _prev: CreateInvoiceState,
  formData: FormData,
): Promise<CreateInvoiceState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'Not allowed to create invoices.' };
  }

  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read line items.' };
  }

  const parsed = invoiceFormSchema.safeParse({
    number: formData.get('number'),
    projectId: formData.get('projectId'),
    proposalId: formData.get('proposalId') ?? '',
    changeOrderId: formData.get('changeOrderId') ?? '',
    templateId: formData.get('templateId') ?? '',
    status: formData.get('status') ?? 'draft',
    billingType: formData.get('billingType') ?? 'progress',
    invoiceDate: formData.get('invoiceDate'),
    dueDate: formData.get('dueDate') ?? '',
    taxAmount: formData.get('taxAmount') ?? '0',
    retainagePercent: formData.get('retainagePercent') ?? '',
    retainageAmount: formData.get('retainageAmount') ?? '0',
    expectedRetainageReleaseDate: formData.get('expectedRetainageReleaseDate') ?? '',
    amountPaid: formData.get('amountPaid') ?? '0',
    notes: formData.get('notes') ?? '',
    termsOverride: formData.get('termsOverride') ?? '',
    percentOfContract: formData.get('percentOfContract') ?? '',
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  // Compute totals server-authoritatively.
  let subtotal = 0;
  const persistLines = data.lines.map((l) => {
    const qty = Number(l.quantity);
    const unitCost = Number(l.unitCost);
    const lineTotal = multiply(qty, unitCost);
    subtotal = add(subtotal, lineTotal);
    return {
      costCodeId: null,
      description: l.description,
      unit: emptyToNull(l.unit ?? null),
      quantity: toQuantityString(qty),
      unitCost: toQuantityString(unitCost),
      lineTotal: toMoneyString(lineTotal),
    };
  });
  const tax = Number(data.taxAmount);
  // If a retainage % is set and a held amount isn't, derive held = subtotal × pct.
  const retainagePctRaw = data.retainagePercent ?? '';
  const retainagePct = retainagePctRaw === '' ? 0 : Number(retainagePctRaw);
  const explicitRetainage = Number(data.retainageAmount);
  const retainage =
    explicitRetainage > 0
      ? explicitRetainage
      : retainagePct > 0
        ? percent(subtotal, retainagePct)
        : 0;
  // If retainage was derived but pct wasn't given, back-compute % for storage.
  const finalRetainagePct =
    retainagePct > 0
      ? retainagePct
      : subtotal > 0 && retainage > 0
        ? (retainage / subtotal) * 100
        : 0;
  const total = subtract(add(subtotal, tax), retainage);
  const amountPaid = Number(data.amountPaid);

  let createdId: string;
  try {
    const inv = await createInvoice(companyId, {
      number: data.number,
      projectId: data.projectId,
      proposalId: emptyToNull(data.proposalId ?? null),
      changeOrderId: emptyToNull(data.changeOrderId ?? null),
      templateId: emptyToNull(data.templateId ?? null),
      status: data.status,
      billingType: data.billingType,
      invoiceDate: data.invoiceDate,
      dueDate: emptyToNull(data.dueDate ?? null),
      subtotal: toMoneyString(subtotal),
      taxAmount: toMoneyString(tax),
      retainagePercent: toPercentString(finalRetainagePct),
      retainageAmount: toMoneyString(retainage),
      retainageReleased: toMoneyString(0),
      expectedRetainageReleaseDate: emptyToNull(
        data.expectedRetainageReleaseDate ?? null,
      ),
      total: toMoneyString(total),
      amountPaid: toMoneyString(amountPaid),
      notes: emptyToNull(data.notes ?? null),
      termsOverride: emptyToNull(data.termsOverride ?? null),
      percentOfContract:
        data.percentOfContract && data.percentOfContract.trim() !== ''
          ? Number(data.percentOfContract).toFixed(3)
          : null,
      lines: persistLines,
    });
    createdId = inv.id;
  } catch (err) {
    if (err instanceof DuplicateInvoiceNumberError) {
      return { errors: { number: ['That invoice number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create invoice: ${message}` };
  }

  revalidatePath('/invoices');
  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath('/dashboard');
  revalidatePath('/accounts-receivable');
  if (retainage > 0) revalidatePath('/retainage');
  redirect(`/invoices/${createdId}`);
}

const headerUpdateSchema = z.object({
  id: z.string().uuid('Missing or invalid id'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  dueDate: z.string().optional().or(z.literal('')),
  billingType: z.enum(billingTypeValues),
  expectedRetainageReleaseDate: z.string().optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  termsOverride: z.string().max(4000).optional().or(z.literal('')),
});

export async function updateInvoiceHeaderAction(
  _prev: UpdateInvoiceHeaderState,
  formData: FormData,
): Promise<UpdateInvoiceHeaderState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'You do not have permission to edit invoices.' };
  }

  const parsed = headerUpdateSchema.safeParse({
    id: formData.get('id'),
    invoiceDate: formData.get('invoiceDate'),
    dueDate: formData.get('dueDate') ?? '',
    billingType: formData.get('billingType') ?? 'progress',
    expectedRetainageReleaseDate:
      formData.get('expectedRetainageReleaseDate') ?? '',
    notes: formData.get('notes') ?? '',
    termsOverride: formData.get('termsOverride') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const existing = await getInvoice(companyId, parsed.data.id);
  if (!existing) {
    return { formError: 'Invoice not found.' };
  }
  // Refuse edits once the invoice has been sent / partially paid / paid /
  // overdue / void. Payments and retainage tracking are derived from the
  // header — silently mutating dates here would corrupt them.
  if (existing.status !== 'draft') {
    return {
      formError: `Invoice is in status "${existing.status}" — only drafts can be edited.`,
    };
  }

  try {
    const updated = await updateInvoiceHeader(companyId, parsed.data.id, {
      invoiceDate: parsed.data.invoiceDate,
      dueDate: emptyToNull(parsed.data.dueDate ?? null),
      billingType: parsed.data.billingType,
      notes: emptyToNull(parsed.data.notes ?? null),
      termsOverride: emptyToNull(parsed.data.termsOverride ?? null),
      expectedRetainageReleaseDate: emptyToNull(
        parsed.data.expectedRetainageReleaseDate ?? null,
      ),
    });
    if (!updated) return { formError: 'Invoice not found in active company.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save invoice: ${message}` };
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${parsed.data.id}`);
  revalidatePath('/dashboard');
  if (existing.projectId) revalidatePath(`/projects/${existing.projectId}`);
  redirect(`/invoices/${parsed.data.id}`);
}

// =====================================================================
// Full-form invoice update — lines + totals + retainage + tax + dates +
// notes/terms + billing fields. Customer/project/invoice-number stay
// locked (changing them silently breaks the audit trail and FKs; users
// who need to change those should void + recreate). Available on every
// non-void invoice; payment links are preserved across edits.
// =====================================================================

const fullUpdateSchema = invoiceFormSchema.extend({
  id: z.string().uuid('Missing or invalid id'),
});

export async function updateInvoiceFullAction(
  _prev: CreateInvoiceState,
  formData: FormData,
): Promise<CreateInvoiceState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'Not allowed to edit invoices.' };
  }

  let parsedLines: unknown;
  try {
    const linesJson = formData.get('lines');
    parsedLines = typeof linesJson === 'string' ? JSON.parse(linesJson) : [];
  } catch {
    return { formError: 'Could not read line items.' };
  }

  const parsed = fullUpdateSchema.safeParse({
    id: formData.get('id'),
    number: formData.get('number'),
    projectId: formData.get('projectId'),
    proposalId: formData.get('proposalId') ?? '',
    changeOrderId: formData.get('changeOrderId') ?? '',
    templateId: formData.get('templateId') ?? '',
    status: formData.get('status') ?? 'draft',
    billingType: formData.get('billingType') ?? 'progress',
    invoiceDate: formData.get('invoiceDate'),
    dueDate: formData.get('dueDate') ?? '',
    taxAmount: formData.get('taxAmount') ?? '0',
    retainagePercent: formData.get('retainagePercent') ?? '',
    retainageAmount: formData.get('retainageAmount') ?? '0',
    expectedRetainageReleaseDate: formData.get('expectedRetainageReleaseDate') ?? '',
    amountPaid: formData.get('amountPaid') ?? '0',
    notes: formData.get('notes') ?? '',
    termsOverride: formData.get('termsOverride') ?? '',
    percentOfContract: formData.get('percentOfContract') ?? '',
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const existing = await getInvoice(companyId, data.id);
  if (!existing) {
    return { formError: 'Invoice not found in active company.' };
  }
  if (existing.status === 'void') {
    return { formError: 'Voided invoices cannot be edited.' };
  }
  // Lock identity-bearing fields. Changing them is a void + recreate path.
  if (existing.number !== data.number) {
    return { errors: { number: ['Invoice number is locked. Void + recreate to change it.'] } };
  }
  if (existing.projectId !== data.projectId) {
    return {
      errors: {
        projectId: ['Project link is locked. Void + recreate to move this invoice to another project.'],
      },
    };
  }

  // Recompute totals server-authoritatively, exactly as createInvoiceAction does.
  let subtotal = 0;
  const persistLines = data.lines.map((l) => {
    const qty = Number(l.quantity);
    const unitCost = Number(l.unitCost);
    const lineTotal = multiply(qty, unitCost);
    subtotal = add(subtotal, lineTotal);
    return {
      costCodeId: null as string | null,
      description: l.description,
      unit: l.unit && l.unit.trim() !== '' ? l.unit : null,
      quantity: toQuantityString(qty),
      unitCost: toQuantityString(unitCost),
      lineTotal: toMoneyString(lineTotal),
    };
  });
  const tax = Number(data.taxAmount);
  const retainagePctRaw = data.retainagePercent ?? '';
  const retainagePct = retainagePctRaw === '' ? 0 : Number(retainagePctRaw);
  const explicitRetainage = Number(data.retainageAmount);
  const retainage =
    explicitRetainage > 0
      ? explicitRetainage
      : retainagePct > 0
        ? percent(subtotal, retainagePct)
        : 0;
  const finalRetainagePct =
    retainagePct > 0
      ? retainagePct
      : subtotal > 0 && retainage > 0
        ? (retainage / subtotal) * 100
        : 0;
  const total = subtract(add(subtotal, tax), retainage);

  try {
    await updateInvoiceFull(companyId, data.id, {
      billingType: data.billingType,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate && data.dueDate !== '' ? data.dueDate : null,
      subtotal: toMoneyString(subtotal),
      taxAmount: toMoneyString(tax),
      retainagePercent: toPercentString(finalRetainagePct),
      retainageAmount: toMoneyString(retainage),
      expectedRetainageReleaseDate:
        data.expectedRetainageReleaseDate && data.expectedRetainageReleaseDate !== ''
          ? data.expectedRetainageReleaseDate
          : null,
      total: toMoneyString(total),
      notes: data.notes && data.notes !== '' ? data.notes : null,
      termsOverride:
        data.termsOverride && data.termsOverride !== '' ? data.termsOverride : null,
      percentOfContract:
        data.percentOfContract && data.percentOfContract.trim() !== ''
          ? Number(data.percentOfContract).toFixed(3)
          : null,
      lines: persistLines,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save invoice: ${message}` };
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${data.id}`);
  revalidatePath('/dashboard');
  revalidatePath('/accounts-receivable');
  if (existing.projectId) revalidatePath(`/projects/${existing.projectId}`);
  if (retainage > 0) revalidatePath('/retainage');
  redirect(`/invoices/${data.id}`);
}

// =====================================================================
// Hard delete — only legal for `draft` invoices with NO payments and NO
// retainage releases. For everything else, use the void transition (soft
// delete) which preserves history.
// =====================================================================

export async function deleteDraftInvoiceAction(
  _prev: { ok?: boolean; formError?: string },
  formData: FormData,
): Promise<{ ok?: boolean; formError?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'Not allowed to delete invoices.' };
  }
  const id = formData.get('id');
  if (typeof id !== 'string' || id === '') {
    return { formError: 'Missing invoice id.' };
  }
  const companyId = await getActiveCompanyId();
  const existing = await getInvoice(companyId, id);
  if (!existing) {
    return { formError: 'Invoice not found.' };
  }
  if (existing.status !== 'draft') {
    return {
      formError:
        'Only drafts can be hard-deleted. Use Void to soft-delete a sent invoice (preserves history).',
    };
  }

  try {
    const ok = await deleteDraftInvoice(companyId, id);
    if (!ok) {
      return {
        formError:
          'Cannot delete: invoice has payments or retainage releases attached. Void it instead.',
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to delete invoice: ${message}` };
  }

  revalidatePath('/invoices');
  revalidatePath('/dashboard');
  revalidatePath('/accounts-receivable');
  if (existing.projectId) revalidatePath(`/projects/${existing.projectId}`);
  redirect('/invoices');
}

// =====================================================================
// Reconciliation backfill — exposed as an admin action so users without
// DB access can run the cleanup from the UI. Idempotent.
// =====================================================================

export type ReconcileBackfillState = {
  formError?: string;
  report?: {
    invoicesScanned: number;
    backfillPaymentsInserted: number;
    invoicesUpdated: number;
    invoicesAlreadyConsistent: number;
  };
};

export async function reconcileInvoicesAction(
  _prev: ReconcileBackfillState,
): Promise<ReconcileBackfillState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { formError: 'Not allowed to run reconciliation.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const report = await reconcileAllInvoices(companyId);
    revalidatePath('/dashboard');
    revalidatePath('/invoices');
    revalidatePath('/accounts-receivable');
    return { report };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Reconciliation failed: ${message}` };
  }
}
