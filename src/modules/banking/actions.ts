'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate, canView } from '@/lib/permissions';
import { toMoneyString } from '@/lib/money';
import {
  ALLOWED_STATEMENT_MIME,
  MAX_STATEMENT_BYTES,
  StatementStorageNotConfiguredError,
  downloadStatementBytes,
  uploadStatementFile,
} from '@/lib/storage/statement-files';
import {
  createBankAccount,
  getBankAccount,
} from '@/lib/data/bank-accounts';
import {
  createImportBatch,
  getImportBatch,
  updateImportBatch,
  upsertMapping,
} from '@/lib/data/statement-imports';
import { updateImportedTransaction } from '@/lib/data/statement-imports';
import {
  ensureDefaultCoaForCompany,
  createPairedAccountingAccount,
} from './lib/coa';
import { parseStatementBytes } from './lib/parse';
import { commitImport, previewMapping } from './lib/import';
import {
  createBankAccountSchema,
  mappingSettingsSchema,
  updateImportedTransactionSchema,
} from './schema';

export type BankingActionState = {
  formError?: string;
  errors?: Record<string, string[]>;
  ok?: boolean;
};

// ===== Bank accounts =====

export async function createBankAccountAction(
  _prev: BankingActionState,
  formData: FormData,
): Promise<BankingActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'bank_accounts')) {
    return { formError: 'You do not have permission to create bank accounts.' };
  }
  const company = await getActiveCompany();
  const parsed = createBankAccountSchema.safeParse({
    name: formData.get('name') ?? '',
    type: formData.get('type') ?? 'bank',
    last4: formData.get('last4') ?? '',
    currency: formData.get('currency') ?? company.defaultCurrency,
    openingBalance: formData.get('openingBalance') ?? '0',
    openingDate: formData.get('openingDate') ?? '',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  // Seed COA on first use, then create the paired accounting account.
  await ensureDefaultCoaForCompany(company);
  const paired = await createPairedAccountingAccount({
    companyId: company.id,
    name: parsed.data.name,
    type: parsed.data.type,
    currency: parsed.data.currency,
  });
  await createBankAccount({
    companyId: company.id,
    accountingAccountId: paired.id,
    name: parsed.data.name,
    type: parsed.data.type,
    last4: parsed.data.last4,
    currency: parsed.data.currency,
    openingBalance: toMoneyString(Number(parsed.data.openingBalance || 0)),
    openingDate: parsed.data.openingDate,
  });
  revalidatePath('/banking');
  return { ok: true };
}

// ===== Statement upload =====

export async function uploadStatementAction(
  _prev: BankingActionState,
  formData: FormData,
): Promise<BankingActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'statement_imports')) {
    return { formError: 'You do not have permission to import statements.' };
  }
  const companyId = await getActiveCompanyId();

  const bankAccountId = z
    .string()
    .uuid()
    .safeParse(formData.get('bankAccountId'));
  if (!bankAccountId.success) {
    return { formError: 'Select a bank account.' };
  }
  const account = await getBankAccount(companyId, bankAccountId.data);
  if (!account) {
    return { formError: 'Bank account not found in the active company.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { formError: 'Choose a file to upload.' };
  }
  if (file.size > MAX_STATEMENT_BYTES) {
    return {
      formError: `File too large. Max ${Math.round(
        MAX_STATEMENT_BYTES / 1024 / 1024,
      )} MB.`,
    };
  }
  const mime = (file.type || 'application/octet-stream').toLowerCase();
  if (!ALLOWED_STATEMENT_MIME.has(mime)) {
    return { formError: `Unsupported file type (${file.type || 'unknown'}).` };
  }

  let createdBatchId: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = await uploadStatementFile({
      companyId,
      bytes,
      mimeType: mime,
      originalFileName: file.name,
    });
    const batch = await createImportBatch({
      companyId,
      bankAccountId: account.id,
      status: 'pending',
      sourceFilename: file.name,
      storagePath: upload.storagePath,
      mimeType: mime,
      byteSize: file.size,
      uploadedByUserId: user.id,
    });
    createdBatchId = batch.id;
  } catch (err) {
    if (err instanceof StatementStorageNotConfiguredError) {
      return { formError: err.message };
    }
    return { formError: err instanceof Error ? err.message : 'Upload failed.' };
  }
  revalidatePath('/banking');
  redirect(`/banking/import/${createdBatchId}` as never);
}

// ===== Commit import =====

export async function commitImportAction(
  batchId: string,
  _prev: BankingActionState,
  formData: FormData,
): Promise<BankingActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'statement_imports')) {
    return { formError: 'You do not have permission to import statements.' };
  }
  const company = await getActiveCompany();
  const batch = await getImportBatch(company.id, batchId);
  if (!batch) return { formError: 'Import batch not found.' };

  // Build the mapping payload from the form.
  const mappingParse = mappingSettingsSchema.safeParse({
    label: formData.get('label') ?? 'Default mapping',
    dateFormat: formData.get('dateFormat') ?? 'YYYY-MM-DD',
    amountStrategy: formData.get('amountStrategy') ?? 'signed_amount',
    decimalSeparator: formData.get('decimalSeparator') ?? '.',
    thousandsSeparator: formData.get('thousandsSeparator') ?? ',',
    skipRows: formData.get('skipRows') ?? '0',
    columnMap: {
      date: formData.get('col_date') ?? '',
      postedDate: formData.get('col_postedDate') ?? '',
      description: formData.get('col_description') ?? '',
      payee: formData.get('col_payee') ?? '',
      memo: formData.get('col_memo') ?? '',
      amount: formData.get('col_amount') ?? '',
      debit: formData.get('col_debit') ?? '',
      credit: formData.get('col_credit') ?? '',
      reference: formData.get('col_reference') ?? '',
    },
  });
  if (!mappingParse.success) {
    return {
      formError: 'Invalid mapping settings.',
      errors: mappingParse.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  // Pull the original file back from storage and parse it.
  const bytes = await downloadStatementBytes(batch.storagePath);
  if (!bytes) {
    return { formError: 'Could not load the original file from storage.' };
  }
  const parsed = await parseStatementBytes({
    bytes,
    mimeType: batch.mimeType,
    filename: batch.sourceFilename,
  });

  // Persist the mapping so the next upload for the same account auto-picks it.
  const savedMapping = await upsertMapping({
    companyId: company.id,
    bankAccountId: batch.bankAccountId,
    label: mappingParse.data.label,
    columnMap: mappingParse.data.columnMap,
    dateFormat: mappingParse.data.dateFormat,
    amountStrategy: mappingParse.data.amountStrategy,
    decimalSeparator: mappingParse.data.decimalSeparator,
    thousandsSeparator: mappingParse.data.thousandsSeparator,
    skipRows: mappingParse.data.skipRows,
    createdByUserId: user.id,
  });

  await updateImportBatch(company.id, batch.id, {
    mappingId: savedMapping.id,
    status: 'mapped',
  });

  const preview = previewMapping({
    rows: parsed.rows,
    mapping: {
      columnMap: mappingParse.data.columnMap,
      dateFormat: mappingParse.data.dateFormat,
      amountStrategy: mappingParse.data.amountStrategy,
      decimalSeparator: mappingParse.data.decimalSeparator,
      thousandsSeparator: mappingParse.data.thousandsSeparator,
      skipRows: mappingParse.data.skipRows,
    },
  });

  if (preview.drafts.length === 0) {
    await updateImportBatch(company.id, batch.id, {
      status: 'failed',
      errorMessage:
        preview.errors[0]?.reason ?? 'No valid rows found in the file.',
      rowCount: parsed.rows.length,
      errorCount: preview.errors.length,
    });
    return {
      formError:
        preview.errors[0]?.reason ?? 'No valid rows found in the file.',
    };
  }

  await commitImport({
    batch,
    drafts: preview.drafts,
    errors: preview.errors,
    defaultCurrency: company.defaultCurrency,
  });

  revalidatePath('/banking');
  revalidatePath(`/banking/accounts/${batch.bankAccountId}`);
  revalidatePath(`/banking/import/${batch.id}`);
  redirect(`/banking/accounts/${batch.bankAccountId}` as never);
}

// ===== Update an imported transaction =====
// Manual triage: assign category, project, cost code; mark reviewed/ignored;
// edit notes/payee/memo. Phase 1 explicitly does NOT post these anywhere.

export async function updateImportedTransactionAction(
  _prev: BankingActionState,
  formData: FormData,
): Promise<BankingActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'statement_imports')) {
    return { formError: 'You do not have permission to edit transactions.' };
  }
  const companyId = await getActiveCompanyId();
  const parsed = updateImportedTransactionSchema.safeParse({
    id: formData.get('id') ?? '',
    accountingAccountId: formData.get('accountingAccountId') ?? '',
    projectId: formData.get('projectId') ?? '',
    costCodeId: formData.get('costCodeId') ?? '',
    isReviewed:
      formData.get('isReviewed') === 'on' ||
      formData.get('isReviewed') === 'true',
    isIgnored:
      formData.get('isIgnored') === 'on' ||
      formData.get('isIgnored') === 'true',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return {
      formError: 'Invalid input.',
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const updated = await updateImportedTransaction(companyId, parsed.data.id, {
    accountingAccountId: parsed.data.accountingAccountId,
    projectId: parsed.data.projectId,
    costCodeId: parsed.data.costCodeId,
    isReviewed: parsed.data.isReviewed ?? false,
    isIgnored: parsed.data.isIgnored ?? false,
    notes: parsed.data.notes,
  });
  if (!updated) return { formError: 'Transaction not found.' };
  revalidatePath(`/banking/accounts/${updated.bankAccountId}`);
  return { ok: true };
}

// ===== Quick mark-reviewed / mark-ignored toggles =====

export async function toggleImportedTransactionFlag(input: {
  id: string;
  flag: 'reviewed' | 'ignored';
  value: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'statement_imports')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const patch =
    input.flag === 'reviewed'
      ? { isReviewed: input.value }
      : { isIgnored: input.value };
  const updated = await updateImportedTransaction(companyId, input.id, patch);
  if (!updated) return { ok: false, error: 'Transaction not found.' };
  revalidatePath(`/banking/accounts/${updated.bankAccountId}`);
  return { ok: true };
}
