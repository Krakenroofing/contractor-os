'use server';

// Vendor credits: record a credit note from a vendor, then apply it against
// bills (receipts) so the remaining due matches the eventual bank payment.
//
// Accounting at each step:
//   Create credit:  Dr Accounts Payable / Cr <expense category>
//                   (we owe the vendor less; the original cost is reduced)
//   Apply to bill:  no GL — application only allocates the already-posted
//                   credit to a specific bill so its net due is right.
//   Delete credit:  reverses by removing the JE (only while unapplied).

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { toMoneyString } from '@/lib/money';
import {
  createVendorCredit,
  createVendorCreditApplication,
  deleteVendorCreditApplication,
  getVendorCredit,
  getVendorCreditApplication,
  listApplicationsForReceipts,
  softDeleteVendorCredit,
  VendorCreditsNotAvailableInDemoError,
} from '@/lib/data/vendor-credits';
import { getVendor } from '@/lib/data/vendors';
import { getReceipt } from '@/lib/data/receipts';
import { getAccountingAccount } from '@/lib/data/accounting-accounts';
import {
  deleteJournalEntriesForSource,
  postJournalEntry,
} from '@/lib/data/general-ledger';
import { resolveGlSystemAccounts } from '@/modules/accounting/lib/gl-posting';
import { getUserNamesByIds } from '@/lib/data/users';

export type VendorCreditActionState = {
  formError?: string;
  ok?: boolean;
};

const idSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneySchema = z
  .string()
  .trim()
  .refine((v) => v !== '' && !Number.isNaN(Number(v.replace(/,/g, ''))), {
    message: 'Enter a valid amount',
  })
  .transform((v) => Math.round(Number(v.replace(/,/g, '')) * 100) / 100);

async function requirePermission(): Promise<
  { companyId: string; userId: string | null } | { error: string }
> {
  const user = await requireAuth();
  const role = await getActiveRole();
  // Bills/receipts territory — the same people who post bills handle credits.
  if (!canCreate(role, 'receipts')) {
    return { error: 'You do not have permission to manage vendor credits.' };
  }
  const companyId = await getActiveCompanyId();
  const known = await getUserNamesByIds([user.id]);
  return { companyId, userId: known.has(user.id) ? user.id : null };
}

export async function createVendorCreditAction(
  _prev: VendorCreditActionState,
  formData: FormData,
): Promise<VendorCreditActionState> {
  const auth = await requirePermission();
  if ('error' in auth) return { formError: auth.error };

  const parsed = z
    .object({
      vendorId: idSchema,
      creditDate: dateSchema,
      amount: moneySchema.refine((v) => v > 0, {
        message: 'Amount must be greater than zero',
      }),
      accountingAccountId: idSchema,
      reference: z.string().trim().max(120).optional().or(z.literal('')),
      notes: z.string().trim().max(2000).optional().or(z.literal('')),
    })
    .safeParse({
      vendorId: formData.get('vendorId'),
      creditDate: formData.get('creditDate'),
      amount: formData.get('amount'),
      accountingAccountId: formData.get('accountingAccountId'),
      reference: formData.get('reference') ?? '',
      notes: formData.get('notes') ?? '',
    });
  if (!parsed.success) {
    return {
      formError:
        parsed.error.issues[0]?.message ??
        'Fill in the date, amount, and category.',
    };
  }
  const input = parsed.data;

  const company = await getActiveCompany();
  const vendor = await getVendor(auth.companyId, input.vendorId);
  if (!vendor) return { formError: 'Vendor not found.' };
  const category = await getAccountingAccount(
    auth.companyId,
    input.accountingAccountId,
  );
  if (!category) return { formError: 'Accounting category not found.' };

  try {
    const credit = await createVendorCredit({
      companyId: auth.companyId,
      vendorId: input.vendorId,
      creditDate: input.creditDate,
      amount: toMoneyString(input.amount),
      accountingAccountId: input.accountingAccountId,
      reference: input.reference || null,
      notes: input.notes || null,
      createdByUserId: auth.userId,
    });
    // GL: we owe the vendor less, and the original cost comes back down.
    // Best-effort like every other GL sync — never blocks the credit.
    try {
      const accounts = await resolveGlSystemAccounts(auth.companyId);
      await postJournalEntry(auth.companyId, {
        entryDate: input.creditDate,
        memo: `Vendor credit — ${vendor.name}${input.reference ? ` (${input.reference})` : ''}`,
        sourceType: 'vendor_credit',
        sourceId: credit.id,
        lines: [
          { accountId: accounts.accountsPayable, debit: input.amount, credit: 0 },
          { accountId: input.accountingAccountId, debit: 0, credit: input.amount },
        ],
      });
    } catch {
      /* GL is rebuilt idempotently; the credit row is the source of truth. */
    }
  } catch (err) {
    if (err instanceof VendorCreditsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    return {
      formError:
        err instanceof Error ? err.message : 'Could not save the credit.',
    };
  }

  void company;
  revalidatePath(`/vendors/${input.vendorId}`);
  revalidatePath('/reports/profit-loss', 'layout');
  return { ok: true };
}

export async function deleteVendorCreditAction(
  creditId: string,
): Promise<VendorCreditActionState> {
  const auth = await requirePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(creditId).success) {
    return { formError: 'Missing credit id.' };
  }
  const credit = await getVendorCredit(auth.companyId, creditId);
  if (!credit) return { formError: 'Credit not found.' };
  if (credit.appliedTotal > 0.005) {
    return {
      formError:
        'This credit is applied to a bill — remove the application(s) first.',
    };
  }
  try {
    await softDeleteVendorCredit(auth.companyId, creditId);
    await deleteJournalEntriesForSource(
      auth.companyId,
      'vendor_credit',
      creditId,
    );
  } catch (err) {
    return {
      formError:
        err instanceof Error ? err.message : 'Could not delete the credit.',
    };
  }
  revalidatePath(`/vendors/${credit.vendorId}`);
  revalidatePath('/reports/profit-loss', 'layout');
  return { ok: true };
}

export async function applyVendorCreditAction(
  _prev: VendorCreditActionState,
  formData: FormData,
): Promise<VendorCreditActionState> {
  const auth = await requirePermission();
  if ('error' in auth) return { formError: auth.error };

  const parsed = z
    .object({
      creditId: idSchema,
      receiptId: idSchema,
      amount: moneySchema.refine((v) => v > 0, {
        message: 'Amount must be greater than zero',
      }),
    })
    .safeParse({
      creditId: formData.get('creditId'),
      receiptId: formData.get('receiptId'),
      amount: formData.get('amount'),
    });
  if (!parsed.success) {
    return {
      formError: parsed.error.issues[0]?.message ?? 'Pick a credit and amount.',
    };
  }
  const input = parsed.data;

  const credit = await getVendorCredit(auth.companyId, input.creditId);
  if (!credit) return { formError: 'Credit not found.' };
  const receipt = await getReceipt(auth.companyId, input.receiptId);
  if (!receipt) return { formError: 'Bill not found.' };
  if (receipt.status === 'void') {
    return { formError: 'Cannot apply a credit to a void bill.' };
  }
  if (receipt.vendorId !== credit.vendorId) {
    return { formError: 'The credit and the bill belong to different vendors.' };
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const openOnCredit = round(Number(credit.amount) - credit.appliedTotal);
  if (input.amount > openOnCredit + 0.005) {
    return {
      formError: `Only ${openOnCredit.toFixed(2)} is left on this credit.`,
    };
  }
  const existing = await listApplicationsForReceipts(auth.companyId, [
    receipt.id,
  ]);
  const alreadyApplied = round(
    existing.reduce((s, a) => s + Number(a.amount), 0),
  );
  const receiptRemaining = round(Number(receipt.total) - alreadyApplied);
  if (input.amount > receiptRemaining + 0.005) {
    return {
      formError: `The bill only has ${receiptRemaining.toFixed(2)} left to offset.`,
    };
  }

  try {
    await createVendorCreditApplication({
      companyId: auth.companyId,
      creditId: credit.id,
      receiptId: receipt.id,
      amount: toMoneyString(input.amount),
    });
  } catch (err) {
    return {
      formError:
        err instanceof Error ? err.message : 'Could not apply the credit.',
    };
  }
  revalidatePath(`/banking/receipts/${receipt.id}`);
  revalidatePath(`/vendors/${credit.vendorId}`);
  return { ok: true };
}

export async function unapplyVendorCreditAction(
  applicationId: string,
): Promise<VendorCreditActionState> {
  const auth = await requirePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(applicationId).success) {
    return { formError: 'Missing application id.' };
  }
  const app = await getVendorCreditApplication(auth.companyId, applicationId);
  if (!app) return { formError: 'Application not found.' };
  try {
    await deleteVendorCreditApplication(auth.companyId, applicationId);
  } catch (err) {
    return {
      formError:
        err instanceof Error ? err.message : 'Could not remove the application.',
    };
  }
  revalidatePath(`/banking/receipts/${app.receiptId}`);
  return { ok: true };
}
