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
  bulkSetInvoiceRevenueCategory,
  createInvoice,
  deleteDraftInvoice,
  DuplicateInvoiceNumberError,
  getInvoice,
  listInvoices,
  setInvoiceRevenueCategory,
  updateInvoiceFull,
  updateInvoiceHeader,
} from '@/lib/data/invoices';
import { getAccountingAccount } from '@/lib/data/accounting-accounts';
import { syncInvoiceGl } from '@/modules/accounting/lib/gl-posting';
import { reconcileAllInvoices } from '@/lib/data/invoice-reconcile';
import {
  applyCreditMemoToInvoice,
  listCreditMemosForCustomer,
} from '@/lib/data/credit-memos';
import { getProject } from '@/lib/data/projects';
import { recomputeProjectContractTotals } from '@/lib/data/change-orders';
import {
  billingTypeValues,
  changeOrderLinkError,
  invoiceFormSchema,
} from './schema';

export type CreateInvoiceState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

export type UpdateInvoiceHeaderState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

/**
 * Set an invoice's revenue category (income-rollup account) for the P&L
 * revenue-by-service-type split. A reporting tag — editable any time from the
 * invoice detail page, including on sent invoices.
 */
export async function setInvoiceRevenueCategoryAction(input: {
  invoiceId: string;
  accountingAccountId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { ok: false, error: 'No permission to edit invoices.' };
  }
  const companyId = await getActiveCompanyId();
  const id = z.string().uuid().safeParse(input.invoiceId);
  if (!id.success) return { ok: false, error: 'Invalid invoice.' };

  let accountingAccountId: string | null = null;
  if (input.accountingAccountId) {
    const a = z.string().uuid().safeParse(input.accountingAccountId);
    if (!a.success) return { ok: false, error: 'Invalid category.' };
    const account = await getAccountingAccount(companyId, a.data);
    if (!account || account.rollupGroup !== 'income') {
      return { ok: false, error: 'Pick an income (revenue) category.' };
    }
    accountingAccountId = a.data;
  }

  const updated = await setInvoiceRevenueCategory(
    companyId,
    id.data,
    accountingAccountId,
  );
  if (!updated) return { ok: false, error: 'Invoice not found.' };
  revalidatePath(`/invoices/${id.data}`);
  revalidatePath('/reports/profit-loss');
  return { ok: true };
}

/**
 * Bulk-set the revenue category on a hand-picked set of invoices — powers the
 * "Categorize revenue" tool, the fast way to split historical revenue by
 * service type across many invoices at once.
 */
export async function bulkSetInvoiceRevenueCategoryAction(input: {
  invoiceIds: string[];
  accountingAccountId: string | null;
}): Promise<{ ok: boolean; applied?: number; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) {
    return { ok: false, error: 'No permission to edit invoices.' };
  }
  const companyId = await getActiveCompanyId();

  const ids = Array.isArray(input.invoiceIds)
    ? input.invoiceIds.filter(
        (x): x is string => typeof x === 'string' && x !== '',
      )
    : [];
  if (ids.length === 0) return { ok: false, error: 'Select at least one invoice.' };

  let accountingAccountId: string | null = null;
  if (input.accountingAccountId) {
    const a = z.string().uuid().safeParse(input.accountingAccountId);
    if (!a.success) return { ok: false, error: 'Invalid category.' };
    const account = await getAccountingAccount(companyId, a.data);
    if (!account || account.rollupGroup !== 'income') {
      return { ok: false, error: 'Pick an income (revenue) category.' };
    }
    accountingAccountId = a.data;
  } else {
    return { ok: false, error: 'Pick a revenue category to assign.' };
  }

  const applied = await bulkSetInvoiceRevenueCategory(
    companyId,
    ids,
    accountingAccountId,
  );
  revalidatePath('/invoices/categorize-revenue');
  revalidatePath('/reports/profit-loss');
  return { ok: true, applied };
}

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
    purchaseOrderNumber: formData.get('purchaseOrderNumber') ?? '',
    billingLabel: formData.get('billingLabel') ?? '',
    percentOfContract: formData.get('percentOfContract') ?? '',
    billAgainstRevised: formData.get('billAgainstRevised') ?? 'false',
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const coErr = changeOrderLinkError(data);
  if (coErr) return { errors: { changeOrderId: [coErr] } };
  const companyId = await getActiveCompanyId();

  // When the user leaves the template dropdown on "— Default —", auto-attach
  // the company's default template so VAT / labels / branding apply without
  // the user having to pick the template manually on every invoice.
  let resolvedTemplateId = emptyToNull(data.templateId ?? null);
  if (!resolvedTemplateId) {
    const { getDefaultInvoiceTemplate } = await import(
      '@/lib/data/invoice-templates'
    );
    const def = await getDefaultInvoiceTemplate(companyId);
    if (def) resolvedTemplateId = def.id;
  }

  // Compute totals server-authoritatively.
  let subtotal = 0;
  const persistLines = data.lines.map((l) => {
    const qty = Number(l.quantity);
    const unitCost = Number(l.unitCost);
    const lineTotal = multiply(qty, unitCost);
    subtotal = add(subtotal, lineTotal);
    return {
      costCodeId: null,
      inventoryItemId: emptyToNull(l.inventoryItemId ?? null),
      description: l.description,
      unit: emptyToNull(l.unit ?? null),
      quantity: toQuantityString(qty),
      unitCost: toQuantityString(unitCost),
      lineTotal: toMoneyString(lineTotal),
      isProjectCredit: l.isProjectCredit ?? false,
    };
  });
  // Credit / deduction lines (negative unit costs) may pull the subtotal down,
  // but the net taxable base still has to be positive — a net-zero-or-negative
  // invoice is a credit note, not an invoice.
  if (!(subtotal > 0)) {
    return {
      formError:
        'Invoice subtotal must be greater than zero. Credit / deduction lines can’t meet or exceed the amount billed — issue a credit memo instead.',
    };
  }
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
      templateId: resolvedTemplateId,
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
      purchaseOrderNumber: emptyToNull(data.purchaseOrderNumber ?? null),
      billingLabel: emptyToNull(data.billingLabel ?? null),
      percentOfContract:
        data.percentOfContract && data.percentOfContract.trim() !== ''
          ? Number(data.percentOfContract).toFixed(3)
          : null,
      billAgainstRevised: data.billAgainstRevised ?? false,
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

  // Phase 1.5: optional open-credit auto-apply. The form prompt below
  // the project picker lets the operator opt in to consuming the
  // customer's open credit balance against this new invoice. We apply
  // FIFO (oldest credits first) until the requested amount is
  // exhausted. Best-effort — credit failures don't roll back the
  // already-created invoice.
  const applyCreditAmountRaw = formData.get('applyCreditAmount');
  const applyCreditAmount =
    typeof applyCreditAmountRaw === 'string' ? Number(applyCreditAmountRaw) : 0;
  if (Number.isFinite(applyCreditAmount) && applyCreditAmount > 0) {
    try {
      const project = await getProject(companyId, data.projectId);
      if (project) {
        const credits = await listCreditMemosForCustomer(companyId, project.customerId);
        // Sort oldest-first by issue_date, exclude fully consumed.
        const eligible = credits
          .filter((c) => Number(c.amount) - Number(c.appliedAmount) > 0.005)
          .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
        let remaining = applyCreditAmount;
        const user = await requireAuth();
        for (const cm of eligible) {
          if (remaining <= 0.005) break;
          const open = Number(cm.amount) - Number(cm.appliedAmount);
          const take = Math.min(open, remaining);
          await applyCreditMemoToInvoice(companyId, cm.id, {
            appliedAt: data.invoiceDate,
            amount: take,
            invoiceId: createdId,
            notes: `Auto-applied at invoice creation`,
            createdByUserId: user.id,
          });
          remaining = Math.round((remaining - take) * 100) / 100;
        }
      }
    } catch (err) {
      // Don't block the redirect on credit-application failure — the
      // operator can apply manually from /credit-memos/[id] later.
      console.error('[invoice-create] credit auto-apply failed:', err);
    }
  }

  // Post to the GL if created already-sent (drafts no-op). Best-effort.
  try {
    await syncInvoiceGl(companyId, createdId);
  } catch {
    /* best-effort — Rebuild can resync */
  }

  // A project-credit line is a downward contract adjustment — re-roll the
  // project's contract totals from source. Best-effort; a hiccup here must
  // never block the invoice.
  try {
    await recomputeProjectContractTotals(data.projectId);
  } catch {
    /* best-effort — Rebuild / self-heal can resync */
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

  // The edit form doesn't render a "% of contract" field, so the raw value
  // is null (field absent) — distinct from '' (operator cleared it). When
  // absent we preserve the stored value below instead of nulling it, which
  // used to silently strip the progress-billing block from the PDF on
  // every edit.
  const percentOfContractRaw = formData.get('percentOfContract');

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
    purchaseOrderNumber: formData.get('purchaseOrderNumber') ?? '',
    billingLabel: formData.get('billingLabel') ?? '',
    percentOfContract: formData.get('percentOfContract') ?? '',
    billAgainstRevised: formData.get('billAgainstRevised') ?? 'false',
    lines: parsedLines,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const coErr = changeOrderLinkError(data);
  if (coErr) return { errors: { changeOrderId: [coErr] } };
  const companyId = await getActiveCompanyId();
  const existing = await getInvoice(companyId, data.id);
  if (!existing) {
    return { formError: 'Invoice not found in active company.' };
  }
  if (existing.status === 'void') {
    return { formError: 'Voided invoices cannot be edited.' };
  }
  // Invoice number is editable, but must stay unique within the company.
  // (Customer/project are still locked — moving an invoice is void+recreate.)
  const newNumber = data.number.trim();
  if (existing.number !== newNumber) {
    if (newNumber === '') {
      return { errors: { number: ['Invoice number is required.'] } };
    }
    const clash = (await listInvoices(companyId)).find(
      (i) => i.id !== data.id && i.number === newNumber,
    );
    if (clash) {
      return {
        errors: {
          number: ['That invoice number is already used by another invoice.'],
        },
      };
    }
  }
  // The project link is normally immutable (void + recreate to move an
  // invoice). Exception: when the linked project has been deleted the invoice
  // is orphaned — reconciliation flags it and nothing else can repair it — so
  // re-linking to a live project in the same company is allowed.
  let projectReassigned = false;
  if (existing.projectId !== data.projectId) {
    const currentProject = await getProject(companyId, existing.projectId);
    if (currentProject) {
      return {
        errors: {
          projectId: ['Project link is locked. Void + recreate to move this invoice to another project.'],
        },
      };
    }
    const newProject = await getProject(companyId, data.projectId);
    if (!newProject) {
      return { errors: { projectId: ['Pick a valid project.'] } };
    }
    projectReassigned = true;
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
      inventoryItemId: emptyToNull(l.inventoryItemId ?? null),
      description: l.description,
      unit: l.unit && l.unit.trim() !== '' ? l.unit : null,
      quantity: toQuantityString(qty),
      unitCost: toQuantityString(unitCost),
      lineTotal: toMoneyString(lineTotal),
      isProjectCredit: l.isProjectCredit ?? false,
    };
  });
  if (!(subtotal > 0)) {
    return {
      formError:
        'Invoice subtotal must be greater than zero. Credit / deduction lines can’t meet or exceed the amount billed — issue a credit memo instead.',
    };
  }
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
      number: newNumber,
      ...(projectReassigned ? { projectId: data.projectId } : {}),
      billingType: data.billingType,
      // A CO link always belongs to the invoice's project — when re-linking
      // an orphaned invoice, any stale CO reference resets to base contract.
      changeOrderId:
        !projectReassigned && data.changeOrderId && data.changeOrderId.trim() !== ''
          ? data.changeOrderId
          : null,
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
      purchaseOrderNumber:
        data.purchaseOrderNumber && data.purchaseOrderNumber !== ''
          ? data.purchaseOrderNumber
          : null,
      billingLabel:
        data.billingLabel && data.billingLabel !== '' ? data.billingLabel : null,
      percentOfContract:
        percentOfContractRaw === null
          ? existing.percentOfContract // field not submitted — preserve
          : data.percentOfContract && data.percentOfContract.trim() !== ''
            ? Number(data.percentOfContract).toFixed(3)
            : null,
      lines: persistLines,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save invoice: ${message}` };
  }

  // Re-post the edited invoice to the GL (idempotent). Best-effort.
  try {
    await syncInvoiceGl(companyId, data.id);
  } catch {
    /* best-effort — Rebuild can resync */
  }

  // Re-roll the project's contract totals: a project-credit line may have been
  // added, changed, or removed by this edit. Best-effort. On a re-link the
  // NEW project's totals absorb the invoice, so recompute that one too.
  try {
    await recomputeProjectContractTotals(existing.projectId);
  } catch {
    /* best-effort — Rebuild / self-heal can resync */
  }
  if (projectReassigned) {
    try {
      await recomputeProjectContractTotals(data.projectId);
    } catch {
      /* best-effort — Rebuild / self-heal can resync */
    }
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${data.id}`);
  revalidatePath('/dashboard');
  revalidatePath('/accounts-receivable');
  if (existing.projectId) revalidatePath(`/projects/${existing.projectId}`);
  if (projectReassigned) revalidatePath(`/projects/${data.projectId}`);
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

  // Deleting a draft that carried a project credit reverses its contract
  // reduction — re-roll from source. Best-effort.
  try {
    await recomputeProjectContractTotals(existing.projectId);
  } catch {
    /* best-effort — Rebuild / self-heal can resync */
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
