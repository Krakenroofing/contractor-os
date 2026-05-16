'use server';

// Phase 2.4 receipt reimbursements — payout actions. Separate from
// receipts/actions.ts to keep the reimbursement surface area discoverable.
//
// Permission: only owners + accounting can record or reverse a payout.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canApproveReceipt } from '@/lib/permissions';
import {
  createPayoutAndLinkLines,
  reversePayout,
} from '@/lib/data/receipt-reimbursements';

const markPaidSchema = z.object({
  paidToUserId: z.string().uuid(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  paidVia: z.string().trim().min(1, 'Payment method required').max(40),
  reference: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  bankAccountId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v)),
  currency: z.string().trim().min(3).max(3).toUpperCase(),
  lineIds: z.array(z.string().uuid()).min(1).max(500),
});

export type MarkPaidActionState = {
  formError?: string;
  ok?: boolean;
  payoutId?: string;
};

export async function markReimbursementPaidAction(
  input: z.input<typeof markPaidSchema>,
): Promise<MarkPaidActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canApproveReceipt(role)) {
    return {
      formError: 'Only owners or accounting can record payouts.',
    };
  }
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;
  const companyId = await getActiveCompanyId();
  try {
    const payout = await createPayoutAndLinkLines({
      companyId,
      paidToUserId: d.paidToUserId,
      paidAt: d.paidAt,
      paidVia: d.paidVia,
      reference: d.reference,
      bankAccountId: d.bankAccountId,
      notes: d.notes,
      createdByUserId: user.id,
      currency: d.currency,
      lineIds: d.lineIds,
    });
    revalidatePath('/banking/reimbursements');
    revalidatePath('/banking');
    return { ok: true, payoutId: payout.id };
  } catch (err) {
    return {
      formError:
        err instanceof Error ? err.message : 'Could not record the payout.',
    };
  }
}

export async function reversePayoutAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canApproveReceipt(role)) {
    return { ok: false, error: 'Only owners or accounting can reverse payouts.' };
  }
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: 'Invalid payout id.' };
  const companyId = await getActiveCompanyId();
  try {
    await reversePayout(companyId, id.data);
    revalidatePath('/banking/reimbursements');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Reverse failed.',
    };
  }
}
