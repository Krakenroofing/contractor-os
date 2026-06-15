'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { toMoneyString } from '@/lib/money';
import { getInvoice } from '@/lib/data/invoices';
import { syncPaymentGl } from '@/modules/accounting/lib/gl-posting';
import {
  createPayment,
  deleteOrphanedPaymentsForVoidedInvoice,
  DuplicatePaymentNumberError,
  InvoiceNotVoidedError,
} from '@/lib/data/invoice-payments';
import { appendActivity } from '@/lib/mock-store';
import { ROLE_LABELS } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { paymentFormSchema } from './schema';

export type CreatePaymentState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createPaymentAction(
  _prev: CreatePaymentState,
  formData: FormData,
): Promise<CreatePaymentState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'payments')) {
    return { formError: 'Not allowed to record payments.' };
  }

  const parsed = paymentFormSchema.safeParse({
    paymentNumber: formData.get('paymentNumber'),
    invoiceId: formData.get('invoiceId'),
    paidDate: formData.get('paidDate'),
    amount: formData.get('amount') ?? '0',
    method: formData.get('method') ?? 'ach',
    reference: formData.get('reference') ?? '',
    bankAccount: formData.get('bankAccount') ?? '',
    status: formData.get('status') ?? 'received',
    notes: formData.get('notes') ?? '',
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  // Verify invoice belongs to active company before doing anything else.
  const invoice = await getInvoice(companyId, data.invoiceId);
  if (!invoice) {
    return { errors: { invoiceId: ['Invoice not found in active company'] } };
  }

  let createdId: string;
  try {
    const payment = await createPayment(companyId, {
      invoiceId: data.invoiceId,
      paymentNumber: data.paymentNumber,
      paidDate: data.paidDate,
      amount: toMoneyString(Number(data.amount)),
      method: data.method,
      reference: emptyToNull(data.reference ?? null),
      bankAccount: emptyToNull(data.bankAccount ?? null),
      status: data.status,
      notes: emptyToNull(data.notes ?? null),
    });
    createdId = payment.id;
  } catch (err) {
    if (err instanceof DuplicatePaymentNumberError) {
      return { errors: { paymentNumber: ['That payment number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to record payment: ${message}` };
  }

  // Post the payment to the GL (Dr Undeposited Funds / Cr AR). Best-effort.
  try {
    await syncPaymentGl(companyId, createdId);
  } catch {
    /* best-effort — Rebuild can resync */
  }

  revalidatePath('/payments');
  revalidatePath('/invoices');
  revalidatePath(`/invoices/${data.invoiceId}`);
  revalidatePath(`/projects/${invoice.projectId}`);
  revalidatePath('/accounts-receivable');
  // Dashboard tiles (outstanding AR, total paid, cash-this-month) are
  // derived from payment rows live — must refresh whenever a payment is
  // recorded.
  revalidatePath('/dashboard');
  redirect(`/payments/${createdId}`);
}

export type DeleteOrphanedPaymentsState = {
  ok?: boolean;
  formError?: string;
  result?: { deletedCount: number; deletedAmount: number };
};

/**
 * Action wired to the "Delete payment rows" buttons on both the voided
 * invoice detail page and the /settings/diagnostics card. Only deletes
 * payments on voided invoices (the data layer enforces this), so a slip
 * can't silently wipe a live invoice's payments.
 */
export async function deleteOrphanedPaymentsAction(
  _prev: DeleteOrphanedPaymentsState,
  formData: FormData,
): Promise<DeleteOrphanedPaymentsState> {
  const role = await getActiveRole();
  // Same permission gate as creating payments — only roles that can record
  // payments can erase the orphan rows on a voided invoice.
  if (!canCreate(role, 'payments')) {
    return { formError: 'Not allowed to delete payments.' };
  }
  const invoiceId = formData.get('invoiceId');
  if (typeof invoiceId !== 'string' || invoiceId === '') {
    return { formError: 'Missing invoice id.' };
  }
  const companyId = await getActiveCompanyId();
  // Pre-fetch for the activity-log entry below; also confirms the invoice
  // belongs to the active company before we attempt the delete.
  const invoice = await getInvoice(companyId, invoiceId);
  if (!invoice) return { formError: 'Invoice not found.' };

  let result: { deletedCount: number; deletedAmount: number };
  try {
    result = await deleteOrphanedPaymentsForVoidedInvoice(companyId, invoiceId);
  } catch (err) {
    if (err instanceof InvoiceNotVoidedError) {
      return { formError: 'Refusing to delete: invoice is not voided.' };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to delete payments: ${message}` };
  }

  if (result.deletedCount === 0) {
    return { formError: 'No payment rows to delete on this invoice.' };
  }

  appendActivity(companyId, {
    entityType: 'invoice',
    entityId: invoiceId,
    kind: 'payment_deleted',
    summary: `Deleted ${result.deletedCount} orphaned payment row${
      result.deletedCount === 1 ? '' : 's'
    } (${formatMoney(result.deletedAmount)}) from voided invoice ${invoice.number}`,
    actorRole: ROLE_LABELS[role],
  });

  revalidatePath('/payments');
  revalidatePath('/invoices');
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/projects/${invoice.projectId}`);
  revalidatePath('/accounts-receivable');
  revalidatePath('/dashboard');
  revalidatePath('/settings/diagnostics');
  // Customer summary report aggregates payment data — refresh too.
  revalidatePath('/reports/customer-summary');
  revalidatePath('/reports/payment-summary');

  return { ok: true, result };
}
