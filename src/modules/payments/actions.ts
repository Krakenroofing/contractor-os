'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { toMoneyString } from '@/lib/money';
import { getInvoice } from '@/lib/data/invoices';
import {
  createPayment,
  DuplicatePaymentNumberError,
} from '@/lib/data/invoice-payments';
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

  revalidatePath('/payments');
  revalidatePath('/invoices');
  revalidatePath(`/invoices/${data.invoiceId}`);
  revalidatePath(`/projects/${invoice.projectId}`);
  revalidatePath('/accounts-receivable');
  redirect(`/payments/${createdId}`);
}
