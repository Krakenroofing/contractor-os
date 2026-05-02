'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
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
  DuplicateInvoiceNumberError,
} from '@/lib/data/invoices';
import { invoiceFormSchema } from './schema';

export type CreateInvoiceState = {
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
  if (retainage > 0) revalidatePath('/retainage');
  redirect(`/invoices/${createdId}`);
}
