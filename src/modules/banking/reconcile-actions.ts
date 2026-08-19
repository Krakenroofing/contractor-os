'use server';

// Bank statement reconciliation actions (QB-style). Kept out of the main
// banking actions.ts (which is already ~2.5k lines of import/match logic).
//
// Flow: start (creates the reconciliation + pre-clears every candidate row,
// since our register comes FROM statement imports) → check/uncheck rows →
// finish (server re-verifies beginning + cleared deposits − cleared payments
// equals the statement ending balance before locking).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getBankAccount } from '@/lib/data/bank-accounts';
import {
  createImportBatch,
  listImportBatches,
} from '@/lib/data/statement-imports';
import {
  deleteBankReconciliation,
  deleteManualBankTransaction,
  getBankReconciliation,
  getOpenBankReconciliation,
  insertBankReconciliation,
  insertManualBankTransaction,
  listReconciliationCandidates,
  setTransactionCleared,
  setTransactionsCleared,
  sumClearedForReconciliation,
  updateBankReconciliation,
  updateManualBankTransaction,
} from '@/lib/data/bank-reconciliations';
import { getImportedTransaction } from '@/lib/data/statement-imports';
import { deleteJournalEntriesForSource } from '@/lib/data/general-ledger';
import { syncBankTxnGl } from '@/modules/accounting/lib/gl-posting';
import { createTransferPairAtomic } from '@/lib/data/transaction-matches';
import { getUserNamesByIds } from '@/lib/data/users';

const EPSILON = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReconcileActionState = {
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
  .transform((v) => round2(Number(v.replace(/,/g, ''))));

async function requireReconcilePermission(): Promise<
  { companyId: string; userId: string | null } | { error: string }
> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'statement_imports')) {
    return { error: 'You do not have permission to reconcile bank accounts.' };
  }
  const companyId = await getActiveCompanyId();
  // Audit FK: the dev-demo synthetic user isn't in the users table, so only
  // stamp created-by when the id really exists (else the insert FK fails).
  const known = await getUserNamesByIds([user.id]);
  return { companyId, userId: known.has(user.id) ? user.id : null };
}

// ===== Start =====

export async function startReconciliationAction(
  _prev: ReconcileActionState,
  formData: FormData,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };

  const parsed = z
    .object({
      bankAccountId: idSchema,
      statementDate: dateSchema,
      beginningBalance: moneySchema,
      endingBalance: moneySchema,
    })
    .safeParse({
      bankAccountId: formData.get('bankAccountId'),
      statementDate: formData.get('statementDate'),
      beginningBalance: formData.get('beginningBalance'),
      endingBalance: formData.get('endingBalance'),
    });
  if (!parsed.success) {
    return { formError: 'Fill in the statement date and balances.' };
  }
  const input = parsed.data;

  const account = await getBankAccount(auth.companyId, input.bankAccountId);
  if (!account) return { formError: 'Bank account not found.' };

  const open = await getOpenBankReconciliation(
    auth.companyId,
    input.bankAccountId,
  );
  if (open) {
    // Resume instead of erroring — there can only be one open per account.
    redirect(`/banking/reconcile/${open.id}`);
  }

  let recId: string;
  try {
    const rec = await insertBankReconciliation({
      companyId: auth.companyId,
      bankAccountId: input.bankAccountId,
      statementDate: input.statementDate,
      beginningBalance: input.beginningBalance,
      endingBalance: input.endingBalance,
      createdByUserId: auth.userId,
    });
    recId = rec.id;
    // Pre-clear every candidate row: our register comes from statement
    // imports, so by default everything on/before the statement date IS on
    // the statement. The operator unchecks strays instead of checking 300
    // rows by hand.
    const candidates = await listReconciliationCandidates(
      auth.companyId,
      input.bankAccountId,
      rec.id,
      input.statementDate,
    );
    await setTransactionsCleared(
      auth.companyId,
      rec.id,
      candidates.map((c) => c.id),
      true,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to start reconciliation: ${message}` };
  }

  revalidatePath('/banking/reconcile', 'layout');
  redirect(`/banking/reconcile/${recId}`);
}

// ===== Edit statement info =====

export async function updateReconciliationInfoAction(
  _prev: ReconcileActionState,
  formData: FormData,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };

  const parsed = z
    .object({
      reconciliationId: idSchema,
      statementDate: dateSchema,
      beginningBalance: moneySchema,
      endingBalance: moneySchema,
    })
    .safeParse({
      reconciliationId: formData.get('reconciliationId'),
      statementDate: formData.get('statementDate'),
      beginningBalance: formData.get('beginningBalance'),
      endingBalance: formData.get('endingBalance'),
    });
  if (!parsed.success) return { formError: 'Fill in all statement fields.' };
  const input = parsed.data;

  const rec = await getBankReconciliation(
    auth.companyId,
    input.reconciliationId,
  );
  if (!rec) return { formError: 'Reconciliation not found.' };
  if (rec.status !== 'in_progress') {
    return { formError: 'Only an in-progress reconciliation can be edited.' };
  }

  await updateBankReconciliation(auth.companyId, rec.id, {
    statementDate: input.statementDate,
    beginningBalance: input.beginningBalance,
    endingBalance: input.endingBalance,
  });

  // Shrinking the period releases cleared rows now dated past the statement.
  if (input.statementDate < rec.statementDate) {
    const stillValid = await listReconciliationCandidates(
      auth.companyId,
      rec.bankAccountId,
      rec.id,
      input.statementDate,
    );
    const validIds = new Set(stillValid.map((t) => t.id));
    const previously = await listReconciliationCandidates(
      auth.companyId,
      rec.bankAccountId,
      rec.id,
      rec.statementDate,
    );
    const toRelease = previously
      .filter((t) => t.bankReconciliationId === rec.id && !validIds.has(t.id))
      .map((t) => t.id);
    await setTransactionsCleared(auth.companyId, rec.id, toRelease, false);
  }

  revalidatePath(`/banking/reconcile/${rec.id}`);
  return { ok: true };
}

// ===== Clear / unclear rows =====

export async function toggleClearedAction(
  reconciliationId: string,
  transactionId: string,
  cleared: boolean,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(reconciliationId).success) {
    return { formError: 'Missing reconciliation id.' };
  }
  if (!idSchema.safeParse(transactionId).success) {
    return { formError: 'Missing transaction id.' };
  }
  const rec = await getBankReconciliation(auth.companyId, reconciliationId);
  if (!rec) return { formError: 'Reconciliation not found.' };
  if (rec.status !== 'in_progress') {
    return { formError: 'This reconciliation is already completed.' };
  }
  await setTransactionCleared(
    auth.companyId,
    rec.id,
    transactionId,
    cleared,
  );
  revalidatePath(`/banking/reconcile/${rec.id}`);
  return { ok: true };
}

export async function setAllClearedAction(
  reconciliationId: string,
  cleared: boolean,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(reconciliationId).success) {
    return { formError: 'Missing reconciliation id.' };
  }
  const rec = await getBankReconciliation(auth.companyId, reconciliationId);
  if (!rec) return { formError: 'Reconciliation not found.' };
  if (rec.status !== 'in_progress') {
    return { formError: 'This reconciliation is already completed.' };
  }
  const candidates = await listReconciliationCandidates(
    auth.companyId,
    rec.bankAccountId,
    rec.id,
    rec.statementDate,
  );
  await setTransactionsCleared(
    auth.companyId,
    rec.id,
    candidates.map((c) => c.id),
    cleared,
  );
  revalidatePath(`/banking/reconcile/${rec.id}`);
  return { ok: true };
}

// ===== Register add-transaction (QB-style, outside reconciliation) =====
//
// The account register can take typed entries directly, like QuickBooks'
// credit-card / bank register: an expense (money out), a deposit / CC credit
// (money in), or a transfer between two of our accounts. Transfers create the
// mirrored entry in the other account and match the pair atomically, so
// neither side ever lands in the categorization queue or the P&L.

export async function addRegisterTransactionAction(
  _prev: ReconcileActionState,
  formData: FormData,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };

  const optionalId = z
    .union([idSchema, z.literal('')])
    .transform((v) => (v === '' ? null : v));
  const parsed = z
    .object({
      bankAccountId: idSchema,
      transactionDate: dateSchema,
      description: z.string().trim().min(1, 'Description is required'),
      entryType: z.enum(['out', 'in', 'transfer']),
      amount: moneySchema.refine((v) => v > 0, {
        message: 'Amount must be greater than zero',
      }),
      accountingAccountId: optionalId,
      vendorId: optionalId,
      projectId: optionalId,
      /** Transfer only: the OTHER account. */
      transferAccountId: optionalId,
      /** Transfer only: 'out' = money leaves this account. */
      transferDirection: z.enum(['out', 'in']).default('out'),
    })
    .safeParse({
      bankAccountId: formData.get('bankAccountId'),
      transactionDate: formData.get('transactionDate'),
      description: formData.get('description'),
      entryType: formData.get('entryType'),
      amount: formData.get('amount'),
      accountingAccountId: formData.get('accountingAccountId') ?? '',
      vendorId: formData.get('vendorId') ?? '',
      projectId: formData.get('projectId') ?? '',
      transferAccountId: formData.get('transferAccountId') ?? '',
      transferDirection: formData.get('transferDirection') ?? 'out',
    });
  if (!parsed.success) {
    return {
      formError:
        parsed.error.issues[0]?.message ?? 'Fill in the transaction fields.',
    };
  }
  const input = parsed.data;

  const account = await getBankAccount(auth.companyId, input.bankAccountId);
  if (!account) return { formError: 'Bank account not found.' };

  const newIds: string[] = [];
  try {
    const batch = await getOrCreateManualBatch(
      auth.companyId,
      input.bankAccountId,
      auth.userId,
    );

    if (input.entryType === 'transfer') {
      if (!input.transferAccountId) {
        return { formError: 'Pick the other account for the transfer.' };
      }
      if (input.transferAccountId === input.bankAccountId) {
        return { formError: 'A transfer needs two different accounts.' };
      }
      const other = await getBankAccount(
        auth.companyId,
        input.transferAccountId,
      );
      if (!other) return { formError: 'The other account was not found.' };

      const signedHere =
        input.transferDirection === 'out' ? -input.amount : input.amount;
      const hereId = await insertManualBankTransaction({
        companyId: auth.companyId,
        batchId: batch.id,
        bankAccountId: input.bankAccountId,
        transactionDate: input.transactionDate,
        description: input.description,
        amount: signedHere,
        dedupeHash: `manual:${randomUUID()}`,
        bankReconciliationId: null,
      });
      const otherBatch = await getOrCreateManualBatch(
        auth.companyId,
        other.id,
        auth.userId,
      );
      const otherId = await insertManualBankTransaction({
        companyId: auth.companyId,
        batchId: otherBatch.id,
        bankAccountId: other.id,
        transactionDate: input.transactionDate,
        description: input.description,
        amount: -signedHere,
        dedupeHash: `manual:${randomUUID()}`,
        bankReconciliationId: null,
      });
      await createTransferPairAtomic({
        companyId: auth.companyId,
        txnAId: hereId,
        txnBId: otherId,
        matchedByUserId: auth.userId,
        notes: 'Manual transfer entered on the register',
      });
      newIds.push(hereId, otherId);
    } else {
      const signed =
        input.entryType === 'out' ? -input.amount : input.amount;
      newIds.push(
        await insertManualBankTransaction({
          companyId: auth.companyId,
          batchId: batch.id,
          bankAccountId: input.bankAccountId,
          transactionDate: input.transactionDate,
          description: input.description,
          amount: signed,
          dedupeHash: `manual:${randomUUID()}`,
          bankReconciliationId: null,
          accountingAccountId: input.accountingAccountId,
          vendorId: input.vendorId,
          projectId: input.projectId,
        }),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to add transaction: ${message}` };
  }

  for (const id of newIds) {
    try {
      await syncBankTxnGl(auth.companyId, id);
    } catch {
      // Best-effort; the rebuild reconverges.
    }
  }

  revalidatePath(`/banking/accounts/${input.bankAccountId}`);
  if (input.transferAccountId) {
    revalidatePath(`/banking/accounts/${input.transferAccountId}`);
  }
  return { ok: true };
}

// ===== Edit / delete a manual entry =====
//
// Hand-typed lines can be wrong (money out that should have been money in,
// a typo'd amount). Imported statement rows mirror the bank and stay
// immutable; ONLY rows from the "Manual entries" batch are editable, and
// only while unmatched and not locked inside a completed reconciliation.

async function guardManualTxn(
  companyId: string,
  txnId: string,
): Promise<
  | { error: string }
  | { txn: NonNullable<Awaited<ReturnType<typeof getImportedTransaction>>> }
> {
  const txn = await getImportedTransaction(companyId, txnId);
  if (!txn) return { error: 'Transaction not found.' };
  if (txn.sourceFilename !== 'Manual entry') {
    return {
      error:
        'Only manually added entries can be edited — imported statement rows mirror the bank.',
    };
  }
  if (txn.reconciledAt) {
    return {
      error:
        'This entry is matched to a receipt / invoice — unmatch it first.',
    };
  }
  if (txn.bankReconciliationId) {
    const rec = await getBankReconciliation(
      companyId,
      txn.bankReconciliationId,
    );
    if (rec && rec.status !== 'in_progress') {
      return {
        error:
          'This entry is locked inside a completed reconciliation — reopen it first.',
      };
    }
  }
  return { txn };
}

export async function updateManualTransactionAction(
  _prev: ReconcileActionState,
  formData: FormData,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };

  const parsed = z
    .object({
      transactionId: idSchema,
      transactionDate: dateSchema,
      description: z.string().trim().min(1, 'Description is required'),
      direction: z.enum(['out', 'in']),
      amount: moneySchema.refine((v) => v > 0, {
        message: 'Amount must be greater than zero',
      }),
    })
    .safeParse({
      transactionId: formData.get('transactionId'),
      transactionDate: formData.get('transactionDate'),
      description: formData.get('description'),
      direction: formData.get('direction'),
      amount: formData.get('amount'),
    });
  if (!parsed.success) {
    return {
      formError:
        parsed.error.issues[0]?.message ?? 'Fill in the transaction fields.',
    };
  }
  const input = parsed.data;

  const guarded = await guardManualTxn(auth.companyId, input.transactionId);
  if ('error' in guarded) return { formError: guarded.error };
  const { txn } = guarded;

  // Keep a cleared row inside its reconciliation's window — a date past the
  // statement date would drop it from the visible list while still counting
  // in the server-side totals.
  if (txn.bankReconciliationId) {
    const rec = await getBankReconciliation(
      auth.companyId,
      txn.bankReconciliationId,
    );
    if (rec && input.transactionDate > rec.statementDate) {
      return {
        formError: 'The transaction date is after the statement ending date.',
      };
    }
  }

  const signed = input.direction === 'out' ? -input.amount : input.amount;
  const ok = await updateManualBankTransaction(
    auth.companyId,
    txn.id,
    {
      transactionDate: input.transactionDate,
      description: input.description,
      amount: signed,
    },
  );
  if (!ok) return { formError: 'Could not update the entry.' };

  try {
    await syncBankTxnGl(auth.companyId, txn.id);
  } catch {
    // GL sync is best-effort; the rebuild reconverges.
  }

  if (txn.bankReconciliationId) {
    revalidatePath(`/banking/reconcile/${txn.bankReconciliationId}`);
  }
  revalidatePath('/banking');
  return { ok: true };
}

export async function deleteManualTransactionAction(
  transactionId: string,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(transactionId).success) {
    return { formError: 'Missing transaction id.' };
  }
  const guarded = await guardManualTxn(auth.companyId, transactionId);
  if ('error' in guarded) return { formError: guarded.error };
  const { txn } = guarded;

  const ok = await deleteManualBankTransaction(auth.companyId, txn.id);
  if (!ok) return { formError: 'Could not delete the entry.' };
  // Clear any GL entry the bank-txn sync/rebuild may have posted for it.
  try {
    await deleteJournalEntriesForSource(auth.companyId, 'bank', txn.id);
  } catch {
    // GL cleanup is best-effort; the rebuild script reconverges anyway.
  }

  if (txn.bankReconciliationId) {
    revalidatePath(`/banking/reconcile/${txn.bankReconciliationId}`);
  }
  revalidatePath('/banking');
  return { ok: true };
}

// ===== Finish / reopen / cancel =====

export async function finishReconciliationAction(
  reconciliationId: string,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(reconciliationId).success) {
    return { formError: 'Missing reconciliation id.' };
  }
  const rec = await getBankReconciliation(auth.companyId, reconciliationId);
  if (!rec) return { formError: 'Reconciliation not found.' };
  if (rec.status !== 'in_progress') {
    return { formError: 'This reconciliation is already completed.' };
  }

  // Server-side difference check — the client button being enabled is not
  // proof; totals are recomputed from the DB.
  const cleared = await sumClearedForReconciliation(auth.companyId, rec.id);
  const clearedBalance = round2(
    Number(rec.beginningBalance) + cleared.deposits - cleared.payments,
  );
  const difference = round2(Number(rec.endingBalance) - clearedBalance);
  if (Math.abs(difference) > EPSILON) {
    return {
      formError: `Difference is ${difference.toFixed(2)} — it must be 0.00 to finish. Check off the right transactions or fix the statement balances.`,
    };
  }

  await updateBankReconciliation(auth.companyId, rec.id, {
    status: 'completed',
    completedAt: new Date(),
  });
  revalidatePath('/banking/reconcile', 'layout');
  redirect('/banking/reconcile?finished=1');
}

export async function reopenReconciliationAction(
  reconciliationId: string,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(reconciliationId).success) {
    return { formError: 'Missing reconciliation id.' };
  }
  const rec = await getBankReconciliation(auth.companyId, reconciliationId);
  if (!rec) return { formError: 'Reconciliation not found.' };
  if (rec.status !== 'completed') {
    return { formError: 'Only a completed reconciliation can be reopened.' };
  }
  const open = await getOpenBankReconciliation(
    auth.companyId,
    rec.bankAccountId,
  );
  if (open) {
    return {
      formError:
        'Finish or cancel the account’s in-progress reconciliation first.',
    };
  }
  await updateBankReconciliation(auth.companyId, rec.id, {
    status: 'in_progress',
    completedAt: null,
  });
  revalidatePath('/banking/reconcile', 'layout');
  redirect(`/banking/reconcile/${rec.id}`);
}

export async function cancelReconciliationAction(
  reconciliationId: string,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };
  if (!idSchema.safeParse(reconciliationId).success) {
    return { formError: 'Missing reconciliation id.' };
  }
  const rec = await getBankReconciliation(auth.companyId, reconciliationId);
  if (!rec) return { formError: 'Reconciliation not found.' };
  if (rec.status !== 'in_progress') {
    return { formError: 'Only an in-progress reconciliation can be cancelled.' };
  }
  // FK is ON DELETE SET NULL, so cleared rows are released automatically.
  await deleteBankReconciliation(auth.companyId, rec.id);
  revalidatePath('/banking/reconcile', 'layout');
  redirect('/banking/reconcile');
}

/** Find-or-create the per-account "Manual entries" batch that hand-typed
 *  bank lines hang off (imported_transactions.batch_id is NOT NULL). */
async function getOrCreateManualBatch(
  companyId: string,
  bankAccountId: string,
  userId: string | null,
) {
  const batches = await listImportBatches(companyId, {
    bankAccountId,
    limit: 200,
  });
  const existing = batches.find((b) => b.sourceFilename === 'Manual entries');
  if (existing) return existing;
  return await createImportBatch({
    companyId,
    bankAccountId,
    status: 'imported',
    sourceFilename: 'Manual entries',
    storagePath: 'manual',
    mimeType: 'manual/entry',
    uploadedByUserId: userId,
  });
}

// ===== Add a missing transaction =====
//
// The statement shows a line the import missed (Chris's QB pain point). The
// manual row goes into a per-account "Manual entries" batch, lands in the
// normal categorization queue, and is pre-cleared into this reconciliation.

export async function addManualTransactionAction(
  _prev: ReconcileActionState,
  formData: FormData,
): Promise<ReconcileActionState> {
  const auth = await requireReconcilePermission();
  if ('error' in auth) return { formError: auth.error };

  const optionalId = z
    .union([idSchema, z.literal('')])
    .transform((v) => (v === '' ? null : v));
  const parsed = z
    .object({
      reconciliationId: idSchema,
      transactionDate: dateSchema,
      description: z.string().trim().min(1, 'Description is required'),
      direction: z.enum(['out', 'in']),
      amount: moneySchema.refine((v) => v > 0, {
        message: 'Amount must be greater than zero',
      }),
      // All optional — a bare date/description/amount entry is still valid;
      // category/payee/job just save a later categorization trip.
      accountingAccountId: optionalId,
      vendorId: optionalId,
      projectId: optionalId,
    })
    .safeParse({
      reconciliationId: formData.get('reconciliationId'),
      transactionDate: formData.get('transactionDate'),
      description: formData.get('description'),
      direction: formData.get('direction'),
      amount: formData.get('amount'),
      accountingAccountId: formData.get('accountingAccountId') ?? '',
      vendorId: formData.get('vendorId') ?? '',
      projectId: formData.get('projectId') ?? '',
    });
  if (!parsed.success) {
    return {
      formError:
        parsed.error.issues[0]?.message ?? 'Fill in the transaction fields.',
    };
  }
  const input = parsed.data;

  const rec = await getBankReconciliation(
    auth.companyId,
    input.reconciliationId,
  );
  if (!rec) return { formError: 'Reconciliation not found.' };
  if (rec.status !== 'in_progress') {
    return { formError: 'This reconciliation is already completed.' };
  }
  if (input.transactionDate > rec.statementDate) {
    return {
      formError: 'The transaction date is after the statement ending date.',
    };
  }

  try {
    const manualBatch = await getOrCreateManualBatch(
      auth.companyId,
      rec.bankAccountId,
      auth.userId,
    );
    const signed =
      input.direction === 'out' ? -input.amount : input.amount;
    const newId = await insertManualBankTransaction({
      companyId: auth.companyId,
      batchId: manualBatch.id,
      bankAccountId: rec.bankAccountId,
      transactionDate: input.transactionDate,
      description: input.description,
      amount: signed,
      dedupeHash: `manual:${randomUUID()}`,
      bankReconciliationId: rec.id,
      accountingAccountId: input.accountingAccountId,
      vendorId: input.vendorId,
      projectId: input.projectId,
    });
    try {
      await syncBankTxnGl(auth.companyId, newId);
    } catch {
      // Best-effort; the rebuild reconverges.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to add transaction: ${message}` };
  }

  revalidatePath(`/banking/reconcile/${rec.id}`);
  return { ok: true };
}
