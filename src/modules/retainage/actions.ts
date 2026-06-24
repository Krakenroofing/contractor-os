'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { toMoneyString } from '@/lib/money';
import { getInvoice } from '@/lib/data/invoices';
import {
  createRetainageRelease,
  DuplicateRetainageReleaseNumberError,
  RetainageOverReleaseError,
} from '@/lib/data/retainage-releases';
import { retainageReleaseFormSchema } from './schema';

export type CreateRetainageReleaseState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createRetainageReleaseAction(
  _prev: CreateRetainageReleaseState,
  formData: FormData,
): Promise<CreateRetainageReleaseState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'retainage')) {
    return { formError: 'Not allowed to release retainage.' };
  }

  const parsed = retainageReleaseFormSchema.safeParse({
    releaseNumber: formData.get('releaseNumber'),
    invoiceId: formData.get('invoiceId'),
    releaseDate: formData.get('releaseDate'),
    amount: formData.get('amount') ?? '0',
    paymentId: formData.get('paymentId') ?? '',
    notes: formData.get('notes') ?? '',
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  const invoice = await getInvoice(companyId, data.invoiceId);
  if (!invoice) {
    return { errors: { invoiceId: ['Invoice not found in active company'] } };
  }

  // VAT on released retention (Bahamas DIR rule): becomes payable at release.
  // Apply the ORIGINAL invoice's effective VAT rate (tax ÷ net-of-retainage),
  // so the rate matches the supply and non-VAT invoices release at 0. Computed
  // server-side from the invoice — never trusted from the client.
  const releaseAmt = Number(data.amount);
  const netOfRetainage =
    Number(invoice.subtotal) - Number(invoice.retainageAmount);
  const effectiveVatRate =
    netOfRetainage > 0 ? Number(invoice.taxAmount) / netOfRetainage : 0;
  const vatRate = Math.round(effectiveVatRate * 100 * 1000) / 1000; // % to 3dp
  const vatAmount = Math.round(releaseAmt * effectiveVatRate * 100) / 100;

  try {
    await createRetainageRelease(companyId, {
      invoiceId: data.invoiceId,
      releaseNumber: data.releaseNumber,
      releaseDate: data.releaseDate,
      amount: toMoneyString(releaseAmt),
      vatRate: vatRate.toFixed(3),
      vatAmount: toMoneyString(vatAmount),
      paymentId: emptyToNull(data.paymentId ?? null),
      notes: emptyToNull(data.notes ?? null),
    });
  } catch (err) {
    if (err instanceof DuplicateRetainageReleaseNumberError) {
      return { errors: { releaseNumber: ['That release number is already used'] } };
    }
    if (err instanceof RetainageOverReleaseError) {
      return { errors: { amount: [err.message] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to record retainage release: ${message}` };
  }

  revalidatePath('/retainage');
  revalidatePath(`/invoices/${data.invoiceId}`);
  revalidatePath(`/projects/${invoice.projectId}`);
  revalidatePath('/accounts-receivable');
  redirect('/retainage');
}
