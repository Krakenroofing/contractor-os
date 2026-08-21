'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { can, canCreate, canView } from '@/lib/permissions';
import { formatMoney, toMoneyString } from '@/lib/money';
import {
  ALLOWED_STATEMENT_MIME,
  MAX_STATEMENT_BYTES,
  StatementStorageNotConfiguredError,
  deleteStatementBlob,
  downloadStatementBytes,
  uploadStatementFile,
} from '@/lib/storage/statement-files';
import {
  createBankAccount,
  getBankAccount,
  updateBankAccount,
} from '@/lib/data/bank-accounts';
import { getUserNamesByIds } from '@/lib/data/users';
import { sumAppliedCreditsByReceipt } from '@/lib/data/vendor-credits';
import { findOrCreatePaymentMethod } from '@/lib/data/payment-methods';
import { syncBankTxnGl } from '@/modules/accounting/lib/gl-posting';
import {
  createImportBatch,
  deleteImportBatch,
  getImportBatch,
  updateImportBatch,
  upsertMapping,
} from '@/lib/data/statement-imports';
import {
  bulkApplyRuleToTransactions,
  bulkCategorizeTransactions,
  getImportedTransaction,
  getImportedTransactionAmounts,
  listLinesForTransactionIds,
  listRecentTransactionsForRules,
  replaceImportedTransactionLines,
  updateImportedTransaction,
  type ImportedTransactionLineInput,
} from '@/lib/data/statement-imports';
import {
  bumpMatchCount,
  createBankingRule,
  getBankingRule,
  listBankingRules,
  setRulePriorities,
  softDeleteBankingRule,
  updateBankingRule,
} from '@/lib/data/banking-rules';
import {
  createInvoicePaymentMatchesAtomic,
  reconcileInvoicesToDepositAtomic,
  type ReconcileOp,
  createReceiptMatchesAtomic,
  createMatchAtomic,
  createTransferPairAtomic,
  listActiveMatchesForCompany,
  listActiveMatchesForTxn,
  reverseMatchAtomic,
} from '@/lib/data/transaction-matches';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { getVendor, listVendors } from '@/lib/data/vendors';
import { listEmployees } from '@/lib/data/employees';
import {
  listOpenPayrollBills,
  getPayrollBill,
} from '@/lib/data/payroll-bills';
import { getPayment, listPayments } from '@/lib/data/invoice-payments';
import { listInvoices } from '@/lib/data/invoices';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { createReceipt, getReceipt, listReceipts } from '@/lib/data/receipts';
import {
  ensureDefaultCoaForCompany,
  createPairedAccountingAccount,
  updatePairedAccountingAccount,
} from './lib/coa';
import { parseStatementBytes } from './lib/parse';
import { commitImport, previewMapping } from './lib/import';
import {
  BANK_ACCOUNT_TYPE_LABEL,
  createBankAccountSchema,
  mappingSettingsSchema,
  updateImportedTransactionSchema,
  upsertRuleSchema,
} from './schema';
import {
  type MatchReason,
  type RuleActionPayload,
  type RuleForMatching,
  matchRule,
  toRuleForMatching,
  toTxnForMatching,
} from './lib/rules';
import { computeVatSplit } from './lib/vat-split';

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

// Edit an existing account — fixes a wrong type (bank vs credit card), name,
// last-4, currency, or the opening balance/date. The paired chart-of-accounts
// entry follows (a type flip also flips its asset/liability rollup). Opening
// changes take full effect on the balance sheet at the next GL rebuild.
export async function updateBankAccountAction(
  _prev: BankingActionState,
  formData: FormData,
): Promise<BankingActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'bank_accounts')) {
    return { formError: 'You do not have permission to edit bank accounts.' };
  }
  const company = await getActiveCompany();
  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) {
    return { formError: 'Missing account id.' };
  }
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

  const existing = await getBankAccount(company.id, id);
  if (!existing) return { formError: 'Account not found.' };

  try {
    await updateBankAccount(company.id, id, {
      name: parsed.data.name,
      type: parsed.data.type,
      last4: parsed.data.last4,
      currency: parsed.data.currency,
      openingBalance: toMoneyString(Number(parsed.data.openingBalance || 0)),
      openingDate: parsed.data.openingDate,
    });
    if (existing.accountingAccountId) {
      await updatePairedAccountingAccount({
        companyId: company.id,
        accountingAccountId: existing.accountingAccountId,
        name: parsed.data.name,
        type: parsed.data.type,
        currency: parsed.data.currency,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save the account: ${message}` };
  }

  revalidatePath('/banking');
  revalidatePath(`/banking/accounts/${id}`);
  return { ok: true };
}

// Shape handed back to inline callers (statement upload, receipt payment,
// reimbursement payout, rule scope). Superset of the {id,label} and
// {id,name,type,last4} option shapes used across the consuming forms.
export type InlineBankAccount = {
  id: string;
  name: string;
  type: 'bank' | 'credit_card';
  last4: string | null;
  label: string;
};

export type InlineCreateBankAccountResult =
  | { ok: true; item: InlineBankAccount }
  | { ok: false; error?: string; errors?: Record<string, string[]> };

// RPC-style create used by the "+ Add new bank account" drawer. Mirrors
// createBankAccountAction (incl. the paired accounting-account creation) but
// returns the created account instead of redirecting, so the caller can select
// it inline and keep the rest of the form intact.
export async function createBankAccountInlineAction(input: {
  name: string;
  type?: string;
  last4?: string;
  openingBalance?: string;
}): Promise<InlineCreateBankAccountResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'bank_accounts')) {
    return {
      ok: false,
      error: 'You do not have permission to create bank accounts.',
    };
  }
  const company = await getActiveCompany();
  const parsed = createBankAccountSchema.safeParse({
    name: input.name ?? '',
    type: input.type ?? 'bank',
    last4: input.last4 ?? '',
    currency: company.defaultCurrency,
    openingBalance: input.openingBalance ?? '0',
    openingDate: '',
  });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  try {
    await ensureDefaultCoaForCompany(company);
    const paired = await createPairedAccountingAccount({
      companyId: company.id,
      name: parsed.data.name,
      type: parsed.data.type,
      currency: parsed.data.currency,
    });
    const account = await createBankAccount({
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
    const last4 = account.last4 ?? null;
    return {
      ok: true,
      item: {
        id: account.id,
        name: account.name,
        type: account.type,
        last4,
        label: `${account.name} — ${BANK_ACCOUNT_TYPE_LABEL[account.type]}${
          last4 ? ` (****${last4})` : ''
        }`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Failed to create bank account: ${message}` };
  }
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

// ===== Delete an import batch =====
//
// Hard-delete: transactions and any match rows cascade automatically via the
// FK chain (imported_transactions.batchId → CASCADE, transaction_matches
// .importedTransactionId → CASCADE). The matched invoice/receipt/job-cost
// rows themselves are NOT deleted — only the match link is severed, so they
// revert to "unmatched" naturally. The uploaded source file in Supabase
// Storage is removed best-effort after the row delete; a storage failure
// does not roll back the DB delete.

export async function deleteImportBatchAction(input: {
  batchId: string;
}): Promise<{ ok: boolean; error?: string; bankAccountId?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'statement_imports')) {
    return { ok: false, error: 'No permission to delete statement imports.' };
  }
  const companyId = await getActiveCompanyId();
  const batchIdParsed = z.string().uuid().safeParse(input.batchId);
  if (!batchIdParsed.success) {
    return { ok: false, error: 'Invalid batch id.' };
  }
  const deleted = await deleteImportBatch(companyId, batchIdParsed.data);
  if (!deleted) return { ok: false, error: 'Import batch not found.' };
  // Best-effort storage cleanup. We've already removed the DB row, so even
  // if the blob lingers it's orphaned and harmless.
  try {
    await deleteStatementBlob(deleted.storagePath);
  } catch {
    // Swallow — DB delete already succeeded.
  }
  revalidatePath('/banking');
  revalidatePath(`/banking/accounts/${deleted.bankAccountId}`);
  return { ok: true, bankAccountId: deleted.bankAccountId };
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

// Split lines arrive as a JSON-encoded hidden field (dynamic count). Amount is
// coerced from string|number and must be non-zero — NEGATIVE lines are allowed
// so income and expense can share one transaction (e.g. a deposit that is
// revenue minus a small bank charge); the SIGNED sum is validated against the
// parent's gross in the action.
const splitLineParseSchema = z.object({
  // Category is OPTIONAL on a split line. This lets the operator auto-split
  // VAT (net + VAT-input) on a transaction NOW and assign the cost category to
  // the net line LATER — the workflow TRB wants. Empty string / null → null
  // (uncategorized). The line table's accounting_account_id is nullable.
  accountingAccountId: z
    .union([z.string().uuid(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v && v !== '' ? v : null)),
  projectId: z.union([z.string(), z.null()]).optional(),
  costCodeId: z.union([z.string(), z.null()]).optional(),
  description: z.union([z.string().max(500), z.null()]).optional(),
  amount: z.coerce
    .number()
    .finite()
    .refine((v) => Math.abs(v) >= 0.005, 'Line amount cannot be zero.'),
});
const splitLinesParseSchema = z.array(splitLineParseSchema).max(50);

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
    vendorId: formData.get('vendorId') ?? '',
    paymentMethodId: formData.get('paymentMethodId') ?? '',
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

  // Common (non-category) fields, shared by split and single paths.
  const commonPatch = {
    vendorId: parsed.data.vendorId,
    paymentMethodId: parsed.data.paymentMethodId,
    isReviewed: parsed.data.isReviewed ?? false,
    isIgnored: parsed.data.isIgnored ?? false,
    notes: parsed.data.notes,
  };

  const isSplit =
    formData.get('split') === 'on' || formData.get('split') === 'true';

  // Need the parent row for its signed amount (to validate the split sum) and
  // its bankAccountId (to revalidate the right page).
  const txn = await getImportedTransaction(companyId, parsed.data.id);
  if (!txn) return { formError: 'Transaction not found.' };

  if (isSplit) {
    let rawLines: unknown;
    try {
      const linesJson = formData.get('linesJson');
      rawLines = JSON.parse(typeof linesJson === 'string' ? linesJson : '[]');
    } catch {
      return { formError: 'Could not read the split lines. Please retry.' };
    }
    const result = splitLinesParseSchema.safeParse(rawLines);
    if (!result.success) {
      return {
        formError: 'Each split line needs a non-zero amount.',
      };
    }
    const lines = result.data;
    if (lines.length === 0) {
      return { formError: 'Add at least one split line, or turn Split off.' };
    }

    const grossCents = Math.round(Math.abs(Number(txn.amount)) * 100);
    const sumCents = lines.reduce(
      (s, l) => s + Math.round(l.amount * 100),
      0,
    );
    if (sumCents !== grossCents) {
      return {
        formError: `Split lines must add up to ${formatMoney(
          Math.abs(Number(txn.amount)),
          txn.currency,
        )} — they currently total ${formatMoney(
          sumCents / 100,
          txn.currency,
        )}.`,
      };
    }

    // Can't mark reviewed with any line still uncategorized (it wouldn't flow
    // into the P&L / Balance Sheet). Saving uncategorized is fine — it lands in
    // the Accounting To-Do. Transfers/reconciled + ignored are exempt.
    if (
      commonPatch.isReviewed &&
      !commonPatch.isIgnored &&
      !txn.reconciledAt &&
      !lines.every((l) => l.accountingAccountId != null)
    ) {
      return { formError: REVIEW_NEEDS_CATEGORY_ERROR };
    }

    const lineInputs: ImportedTransactionLineInput[] = lines.map((l) => ({
      accountingAccountId: l.accountingAccountId,
      projectId: l.projectId ? l.projectId : null,
      costCodeId: l.costCodeId ? l.costCodeId : null,
      description: l.description ? l.description : null,
      amount: toMoneyString(l.amount),
    }));
    await replaceImportedTransactionLines(companyId, parsed.data.id, lineInputs);
    // Lines are the source of truth → clear the single-category fields so the
    // transaction never carries two conflicting categorizations.
    await updateImportedTransaction(companyId, parsed.data.id, {
      accountingAccountId: null,
      projectId: null,
      costCodeId: null,
      ...commonPatch,
    });
  } else {
    // Single category → drop any prior split lines and stamp the single fields.
    if (
      commonPatch.isReviewed &&
      !commonPatch.isIgnored &&
      !txn.reconciledAt &&
      !parsed.data.accountingAccountId
    ) {
      return { formError: REVIEW_NEEDS_CATEGORY_ERROR };
    }
    await replaceImportedTransactionLines(companyId, parsed.data.id, []);
    await updateImportedTransaction(companyId, parsed.data.id, {
      accountingAccountId: parsed.data.accountingAccountId,
      projectId: parsed.data.projectId,
      costCodeId: parsed.data.costCodeId,
      ...commonPatch,
    });
  }

  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
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
  if (input.flag === 'reviewed' && input.value) {
    const txn = await getImportedTransaction(companyId, input.id);
    if (!txn) return { ok: false, error: 'Transaction not found.' };
    if (!(await isReadyForReview(companyId, txn))) {
      return { ok: false, error: REVIEW_NEEDS_CATEGORY_ERROR };
    }
  }
  const patch =
    input.flag === 'reviewed'
      ? { isReviewed: input.value }
      : { isIgnored: input.value };
  const updated = await updateImportedTransaction(companyId, input.id, patch);
  if (!updated) return { ok: false, error: 'Transaction not found.' };
  // Ignoring / un-ignoring changes whether the txn posts to the GL at all.
  if (input.flag === 'ignored') await syncTxnGlSafe(companyId, updated.id);
  revalidatePath(`/banking/accounts/${updated.bankAccountId}`);
  return { ok: true };
}

// =====================================================================
// Banking Rules — Phase 1
// =====================================================================

function parseRuleForm(formData: FormData) {
  // The form serializes matchers as parallel arrays: matchers[].field,
  // matchers[].op, matchers[].value, matchers[].case_sensitive. We zip them
  // back here so Zod sees an array of objects.
  const fields = formData.getAll('matcher_field').map(String);
  const ops = formData.getAll('matcher_op').map(String);
  const values = formData.getAll('matcher_value').map(String);
  const caseSens = formData.getAll('matcher_case').map(String);
  const matchers = fields.map((field, i) => ({
    field,
    op: ops[i] ?? 'contains',
    value: values[i] ?? '',
    case_sensitive: caseSens[i] === 'on' || caseSens[i] === 'true',
  }));

  return upsertRuleSchema.safeParse({
    id: (formData.get('id') as string) || undefined,
    name: formData.get('name') ?? '',
    enabled:
      formData.get('enabled') === 'on' || formData.get('enabled') === 'true',
    priority: formData.get('priority') ?? '100',
    appliesTo: formData.get('appliesTo') ?? 'all',
    matchMode: formData.get('matchMode') ?? 'all',
    bankAccountId: formData.get('bankAccountId') ?? '',
    amountMin: formData.get('amountMin') ?? '',
    amountMax: formData.get('amountMax') ?? '',
    matchers,
    actions: {
      accountingAccountId: formData.get('action_accountingAccountId') ?? '',
      projectId: formData.get('action_projectId') ?? '',
      costCodeId: formData.get('action_costCodeId') ?? '',
      notes: formData.get('action_notes') ?? '',
      vendorId: formData.get('action_vendorId') ?? '',
      autoVatSplit:
        formData.get('action_autoVatSplit') === 'on' ||
        formData.get('action_autoVatSplit') === 'true',
      vatRateOverride: formData.get('action_vatRateOverride') ?? '',
    },
  });
}

export async function upsertRuleAction(
  _prev: BankingActionState,
  formData: FormData,
): Promise<BankingActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'banking_rules')) {
    return { formError: 'You do not have permission to manage rules.' };
  }
  const companyId = await getActiveCompanyId();
  const parsed = parseRuleForm(formData);
  if (!parsed.success) {
    return {
      formError: 'Fix the highlighted fields.',
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  // An auto-VAT-split rule needs a net/cost category to post the ex-VAT line
  // to — the VAT half always goes to the VAT Input account.
  if (d.actions.autoVatSplit && !d.actions.accountingAccountId) {
    return {
      formError:
        'Auto-VAT split needs a net / cost category — that is where the ex-VAT amount posts.',
    };
  }

  const values = {
    companyId,
    name: d.name,
    enabled: d.enabled ?? true,
    priority: d.priority,
    appliesTo: d.appliesTo,
    matchMode: d.matchMode,
    bankAccountId: d.bankAccountId,
    amountMin: d.amountMin === null ? null : toMoneyString(d.amountMin),
    amountMax: d.amountMax === null ? null : toMoneyString(d.amountMax),
    matchers: d.matchers,
    actions: d.actions,
    createdByUserId: user.id,
  } as const;

  if (d.id) {
    const existing = await getBankingRule(companyId, d.id);
    if (!existing) return { formError: 'Rule not found.' };
    await updateBankingRule(companyId, d.id, values);
  } else {
    await createBankingRule(values);
  }

  revalidatePath('/banking');
  revalidatePath('/banking/rules');
  redirect('/banking/rules' as never);
}

export async function toggleRuleEnabledAction(input: {
  id: string;
  enabled: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'banking_rules')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const updated = await updateBankingRule(companyId, input.id, {
    enabled: input.enabled,
  });
  if (!updated) return { ok: false, error: 'Rule not found.' };
  revalidatePath('/banking/rules');
  return { ok: true };
}

export async function deleteRuleAction(input: {
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'banking_rules')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const updated = await softDeleteBankingRule(companyId, input.id);
  if (!updated) return { ok: false, error: 'Rule not found.' };
  revalidatePath('/banking/rules');
  return { ok: true };
}

// ===== Rule application internals (shared by single + bulk apply) =====

type RuleVatContext = {
  vatInputAccountId: string | null;
  /** Rate from the rule's stamped vendor, if any. */
  vendorRatePercent: number | null;
  /** Company standard VAT rate (0 when not VAT-active). */
  companyRatePercent: number;
  isVatActive: boolean;
};

/** Resolve everything an auto-VAT-split rule needs ONCE, so bulk apply doesn't
 *  re-query per row. Returns an inert context when the rule isn't splitting. */
async function resolveRuleVatContext(
  company: { id: string; isVatActive: boolean; vatRatePercent: string | null },
  actions: RuleActionPayload,
): Promise<RuleVatContext> {
  if (!actions.autoVatSplit || !company.isVatActive) {
    return {
      vatInputAccountId: null,
      vendorRatePercent: null,
      companyRatePercent: 0,
      isVatActive: company.isVatActive,
    };
  }
  const accounts = await listAccountingAccounts(company.id);
  const vatInputAccountId =
    accounts.find((a) => a.type === 'vat_input' && !a.isArchived)?.id ?? null;
  let vendorRatePercent: number | null = null;
  if (actions.vendorId) {
    const vendor = await getVendor(company.id, actions.vendorId);
    vendorRatePercent =
      vendor?.vatRatePercent != null ? Number(vendor.vatRatePercent) : null;
  }
  return {
    vatInputAccountId,
    vendorRatePercent,
    companyRatePercent: company.vatRatePercent ? Number(company.vatRatePercent) : 0,
    isVatActive: true,
  };
}

/** Override → stamped-vendor rate → company standard. Null when nothing
 *  resolves to a positive rate (caller then writes a single category). */
function resolveRuleVatRate(
  actions: RuleActionPayload,
  ctx: RuleVatContext,
): number | null {
  if (!ctx.isVatActive) return null;
  const candidates = [
    typeof actions.vatRateOverride === 'number' ? actions.vatRateOverride : null,
    ctx.vendorRatePercent,
    ctx.companyRatePercent > 0 ? ctx.companyRatePercent : null,
  ];
  return candidates.find((r) => r != null && r > 0) ?? null;
}

type ApplyTargetTxn = {
  id: string;
  amount: string;
  notes: string | null;
  vendorId: string | null;
};

/** Write a rule's actions onto a single (already matched + triagable) txn.
 *  Splits into a net cost line + a VAT Input line when the rule asks for it
 *  and a rate + VAT Input account resolve; otherwise stamps a single category.
 *  Always stamps the payee and the applied-rule audit fields. */
async function writeRuleToTransaction(
  companyId: string,
  rule: { id: string; name: string },
  actions: RuleActionPayload,
  txn: ApplyTargetTxn,
  ctx: RuleVatContext,
): Promise<void> {
  const noteSuffix = `\n— rule: ${rule.name}`;
  const notes = (
    actions.notes
      ? `${actions.notes}${noteSuffix}`
      : (txn.notes ?? '') + noteSuffix
  ).trim();
  const vendorId = actions.vendorId ?? txn.vendorId ?? null;

  const rate = actions.autoVatSplit ? resolveRuleVatRate(actions, ctx) : null;
  const canSplit =
    rate != null &&
    ctx.vatInputAccountId != null &&
    actions.accountingAccountId != null;

  if (actions.autoVatSplit && canSplit) {
    const gross = Math.abs(Number(txn.amount));
    const { net, vat } = computeVatSplit(gross, rate);
    const lines: ImportedTransactionLineInput[] = [
      {
        accountingAccountId: actions.accountingAccountId!,
        projectId: actions.projectId ?? null,
        costCodeId: actions.costCodeId ?? null,
        description: 'Cost (ex-VAT)',
        amount: toMoneyString(net),
      },
      {
        accountingAccountId: ctx.vatInputAccountId,
        projectId: null,
        costCodeId: null,
        description: `VAT input @ ${rate}%`,
        amount: toMoneyString(vat),
      },
    ];
    await replaceImportedTransactionLines(companyId, txn.id, lines);
    // Lines are the source of truth → clear the single-category fields.
    await updateImportedTransaction(companyId, txn.id, {
      accountingAccountId: null,
      projectId: null,
      costCodeId: null,
      vendorId,
      notes,
      appliedRuleId: rule.id,
      appliedRuleAt: new Date(),
    });
    return;
  }

  // Single category → drop any stale split lines and stamp the fields.
  await replaceImportedTransactionLines(companyId, txn.id, []);
  await updateImportedTransaction(companyId, txn.id, {
    accountingAccountId: actions.accountingAccountId ?? null,
    projectId: actions.projectId ?? null,
    costCodeId: actions.costCodeId ?? null,
    vendorId,
    notes,
    appliedRuleId: rule.id,
    appliedRuleAt: new Date(),
  });
}

/**
 * Apply a banking rule to a single imported_transactions row.
 *
 * Phase 1 safety:
 *   - Re-runs the matcher server-side before writing. A stale "Apply" click
 *     can't push a rule that no longer matches.
 *   - **Skip silently** if the transaction is already reviewed or already
 *     has an accounting category set. Per Phase 1 contract — we never
 *     overwrite human work.
 *   - Writes only the fields the table supports today: accountingAccountId,
 *     projectId, costCodeId, notes (prepended with "— rule: <name>" suffix).
 *   - Sets applied_rule_id + applied_rule_at so the UI shows the
 *     "auto-filled — awaiting review" state.
 *   - Does NOT set isReviewed — the operator must explicitly mark reviewed.
 *   - Increments the rule's match_count.
 */
export async function applyRuleAction(input: {
  transactionId: string;
  ruleId: string;
}): Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'statement_imports')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const [txn, rule] = await Promise.all([
    getImportedTransaction(companyId, input.transactionId),
    getBankingRule(companyId, input.ruleId),
  ]);
  if (!txn) return { ok: false, error: 'Transaction not found.' };
  if (!rule) return { ok: false, error: 'Rule not found.' };

  // Skip silently — do not overwrite human work.
  if (txn.isReviewed) {
    return { ok: true, skipped: true, reason: 'Transaction is already reviewed.' };
  }
  if (txn.accountingAccountId) {
    return {
      ok: true,
      skipped: true,
      reason: 'Transaction is already categorized.',
    };
  }

  // Re-run the matcher so a stale Apply click can't push a rule that no
  // longer matches (the user may have edited the rule or the row).
  const ruleForMatch: RuleForMatching = toRuleForMatching(rule);
  const result = matchRule(
    {
      bankAccountId: txn.bankAccountId,
      description: txn.description,
      payee: txn.payee,
      memo: txn.memo,
      reference: txn.reference,
      amount: Number(txn.amount),
      isReviewed: txn.isReviewed,
      isIgnored: txn.isIgnored,
      accountingAccountId: txn.accountingAccountId,
      appliedRuleId: txn.appliedRuleId,
    },
    ruleForMatch,
  );
  if (!result.matched) {
    return {
      ok: false,
      error: 'Rule no longer matches this transaction.',
    };
  }

  const actions = ruleForMatch.actions;
  const company = await getActiveCompany();
  const vatCtx = await resolveRuleVatContext(company, actions);
  await writeRuleToTransaction(
    companyId,
    { id: rule.id, name: rule.name },
    actions,
    { id: txn.id, amount: txn.amount, notes: txn.notes, vendorId: txn.vendorId },
    vatCtx,
  );
  await bumpMatchCount(companyId, rule.id);

  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
}

// A transaction can be marked reviewed only when its money has a home in the
// books — a single category, or a fully-categorized split — so every reviewed
// expense/income flows into the P&L and Balance Sheet. Transfers / owner
// equity (reconciled) and ignored rows are exempt: they legitimately carry no
// category. Uncategorized rows can still be SAVED (they surface in the
// Accounting To-Do); they just can't be marked reviewed/complete.
const REVIEW_NEEDS_CATEGORY_ERROR =
  'Categorize this transaction (every split line) before marking it reviewed — an uncategorized expense or income won’t flow into the P&L or Balance Sheet. Transfers are exempt.';

async function isReadyForReview(
  companyId: string,
  txn: {
    id: string;
    isIgnored: boolean;
    reconciledAt: Date | null;
    accountingAccountId: string | null;
  },
): Promise<boolean> {
  if (txn.isIgnored || txn.reconciledAt) return true;
  if (txn.accountingAccountId) return true;
  const lines = await listLinesForTransactionIds(companyId, [txn.id]);
  return lines.length > 0 && lines.every((l) => l.accountingAccountId != null);
}

/**
 * Mark a transaction reviewed in one click. Used on auto-filled rows and on
 * manually-categorized rows. View-only roles cannot review.
 */
export async function markTransactionReviewedAction(input: {
  id: string;
  reviewed: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  if (input.reviewed) {
    const txn = await getImportedTransaction(companyId, input.id);
    if (!txn) return { ok: false, error: 'Transaction not found.' };
    if (!(await isReadyForReview(companyId, txn))) {
      return { ok: false, error: REVIEW_NEEDS_CATEGORY_ERROR };
    }
  }
  const updated = await updateImportedTransaction(companyId, input.id, {
    isReviewed: input.reviewed,
  });
  if (!updated) return { ok: false, error: 'Transaction not found.' };
  revalidatePath(`/banking/accounts/${updated.bankAccountId}`);
  return { ok: true };
}

// =====================================================================
// Banking Rules — Phase 2
// =====================================================================

const reorderInputSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

/** Persist a new priority order. Index → priority × 10 so the operator can
 *  later slot a new rule in between without re-saving the whole list. */
export async function reorderRulesAction(input: {
  orderedIds: string[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'banking_rules')) {
    return { ok: false, error: 'No permission.' };
  }
  const parsed = reorderInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const companyId = await getActiveCompanyId();
  const pairs = parsed.data.orderedIds.map((id, i) => ({
    id,
    priority: (i + 1) * 10,
  }));
  await setRulePriorities(companyId, pairs);
  revalidatePath('/banking/rules');
  return { ok: true };
}

export type PreviewMatch = {
  transactionId: string;
  transactionDate: string;
  description: string;
  amount: string;
  reasons: MatchReason[];
};

export type PreviewMatchesResult = {
  ok: true;
  matches: PreviewMatch[];
  totalHits: number;
  scanned: number;
  truncated: boolean;
};

/** Preview which transactions a SAVED rule would match. Scans the most recent
 *  500 txns, returns up to 25 sample rows + total hit count. */
export async function previewRuleMatchesAction(input: {
  ruleId: string;
}): Promise<PreviewMatchesResult | { ok: false; error: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'banking_rules')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const rule = await getBankingRule(companyId, input.ruleId);
  if (!rule) return { ok: false, error: 'Rule not found.' };

  const ruleForMatch = toRuleForMatching(rule);
  const txns = await listRecentTransactionsForRules(companyId, {
    limit: 500,
    onlyTriagable: false,
  });

  const matches: PreviewMatch[] = [];
  let totalHits = 0;
  for (const t of txns) {
    const txnLike = toTxnForMatching({
      bankAccountId: t.bankAccountId,
      description: t.description,
      payee: t.payee,
      memo: t.memo,
      reference: t.reference,
      amount: t.amount,
      isReviewed: t.isReviewed,
      isIgnored: t.isIgnored,
      accountingAccountId: t.accountingAccountId,
      appliedRuleId: t.appliedRuleId,
    });
    const res = matchRule(txnLike, ruleForMatch);
    if (!res.matched) continue;
    totalHits++;
    if (matches.length < 25) {
      matches.push({
        transactionId: t.id,
        transactionDate: t.transactionDate,
        description: t.description,
        amount: t.amount,
        reasons: res.reasons,
      });
    }
  }

  return {
    ok: true,
    matches,
    totalHits,
    scanned: txns.length,
    truncated: totalHits > matches.length,
  };
}

export type BulkApplyResult =
  | {
      ok: true;
      applied: number;
      scanned: number;
      skipped: number;
    }
  | { ok: false; error: string };

/** Bulk-apply a rule to every triagable transaction it matches.
 *  Triagable = !isReviewed && !isIgnored && accountingAccountId IS NULL.
 *  Never overwrites human work. Never posts. */
export async function bulkApplyRuleAction(input: {
  ruleId: string;
}): Promise<BulkApplyResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission to apply rules.' };
  }
  const companyId = await getActiveCompanyId();
  const rule = await getBankingRule(companyId, input.ruleId);
  if (!rule) return { ok: false, error: 'Rule not found.' };

  const ruleForMatch = toRuleForMatching(rule);
  const txns = await listRecentTransactionsForRules(companyId, {
    limit: 500,
    onlyTriagable: true,
  });

  const targetIds: string[] = [];
  for (const t of txns) {
    const txnLike = toTxnForMatching({
      bankAccountId: t.bankAccountId,
      description: t.description,
      payee: t.payee,
      memo: t.memo,
      reference: t.reference,
      amount: t.amount,
      isReviewed: t.isReviewed,
      isIgnored: t.isIgnored,
      accountingAccountId: t.accountingAccountId,
      appliedRuleId: t.appliedRuleId,
    });
    const res = matchRule(txnLike, ruleForMatch);
    if (res.matched) targetIds.push(t.id);
  }

  if (targetIds.length === 0) {
    return { ok: true, applied: 0, scanned: txns.length, skipped: 0 };
  }

  const actions = ruleForMatch.actions;
  let applied = 0;

  if (actions.autoVatSplit) {
    // Each row's gross differs, so the split can't be batched in one UPDATE —
    // apply per row, re-guarding triagability against a stale snapshot.
    const company = await getActiveCompany();
    const vatCtx = await resolveRuleVatContext(company, actions);
    for (const id of targetIds) {
      const t = await getImportedTransaction(companyId, id);
      if (!t || t.isReviewed || t.isIgnored || t.accountingAccountId) continue;
      await writeRuleToTransaction(
        companyId,
        { id: rule.id, name: rule.name },
        actions,
        { id: t.id, amount: t.amount, notes: t.notes, vendorId: t.vendorId },
        vatCtx,
      );
      applied++;
    }
  } else {
    const noteSuffix = `\n— rule: ${rule.name}`;
    const newNotes = ((actions.notes ?? '') + noteSuffix).trim();
    applied = await bulkApplyRuleToTransactions(companyId, rule.id, targetIds, {
      accountingAccountId: actions.accountingAccountId ?? null,
      projectId: actions.projectId ?? null,
      costCodeId: actions.costCodeId ?? null,
      vendorId: actions.vendorId ?? null,
      notes: newNotes,
      appliedRuleId: rule.id,
      appliedRuleAt: new Date(),
    });
  }

  if (applied > 0) await bumpMatchCount(companyId, rule.id, applied);

  revalidatePath('/banking');
  revalidatePath('/banking/rules');

  return {
    ok: true,
    applied,
    scanned: txns.length,
    skipped: targetIds.length - applied,
  };
}

/**
 * Manual bulk categorize — stamp project / category / cost code / vendor onto
 * a set of hand-picked transactions in one action. Powers the "Categorize to
 * jobs" tool: the fastest way to get a bank feed's spend assigned to projects
 * so it flows into job costs and the WIP report. Only the fields the operator
 * set are written; split rows and ignored rows are skipped server-side.
 */
export async function bulkCategorizeTransactionsAction(input: {
  bankAccountId: string;
  transactionIds: string[];
  accountingAccountId?: string | null;
  projectId?: string | null;
  costCodeId?: string | null;
  vendorId?: string | null;
  markReviewed?: boolean;
}): Promise<{ ok: boolean; applied?: number; error?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission to categorize transactions.' };
  }
  const companyId = await getActiveCompanyId();

  const ids = Array.isArray(input.transactionIds)
    ? input.transactionIds.filter((x) => typeof x === 'string' && x !== '')
    : [];
  if (ids.length === 0) {
    return { ok: false, error: 'Select at least one transaction.' };
  }

  const patch: {
    accountingAccountId?: string;
    projectId?: string;
    costCodeId?: string;
    vendorId?: string;
  } = {};
  if (input.accountingAccountId) patch.accountingAccountId = input.accountingAccountId;
  if (input.projectId) patch.projectId = input.projectId;
  if (input.costCodeId) patch.costCodeId = input.costCodeId;
  if (input.vendorId) patch.vendorId = input.vendorId;

  const markReviewed = Boolean(input.markReviewed);
  if (Object.keys(patch).length === 0 && !markReviewed) {
    return {
      ok: false,
      error: 'Choose a project, category, cost code, or vendor to assign.',
    };
  }

  const applied = await bulkCategorizeTransactions(
    companyId,
    ids,
    patch,
    markReviewed,
  );

  if (patch.accountingAccountId || patch.projectId) {
    await syncTxnGlSafe(companyId, ...ids);
  }

  revalidatePath(`/banking/accounts/${input.bankAccountId}`);
  revalidatePath(`/banking/accounts/${input.bankAccountId}/categorize`);
  return { ok: true, applied };
}

// Keep the import referenced so future-phase code paths don't have to
// re-import. (listBankingRules is consumed by the rules page directly.)
void listBankingRules;

// =====================================================================
// Reconciliation Matching — Phase 1
// =====================================================================
//
// Safety rules:
//   - One ACTIVE match per imported_transaction. Enforced by partial unique
//     index on transaction_matches; the action layer pre-checks for a
//     friendlier error.
//   - One ACTIVE match per target record (invoice_payment, receipt,
//     job_cost_entry). Same enforcement.
//   - Match is non-mutating on the target — the linked invoice payment /
//     receipt / job_cost_entry is read-only here.
//   - Unmatch sets reversed_at, never deletes.
//   - Transfers create two match rows atomically; unmatch reverses both.

const matchTxnIdSchema = z.string().uuid();

type CommonMatchInput = {
  transactionId: string;
};

// Dev-demo auth uses a synthetic user id that isn't in the users table —
// stamp matched-by only when the id really exists so the FK can't fail
// (same guard as receipts/reconciliation actions).
async function safeMatchUserId(userId: string): Promise<string | null> {
  const known = await getUserNamesByIds([userId]);
  return known.has(userId) ? userId : null;
}

// ===== Payment methods — user-managed list, created on the fly =====

export async function createPaymentMethodAction(input: {
  name: string;
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  await requireAuth();
  const role = await getActiveRole();
  // Anyone who can edit expense details (banking rows / receipts) can add a
  // payment method — it's reference data, not a financial posting.
  if (!can(role, 'statement_imports', 'create') && !canCreate(role, 'receipts')) {
    return { ok: false, error: 'No permission to add payment methods.' };
  }
  const name = (input.name ?? '').trim();
  if (name.length === 0 || name.length > 60) {
    return { ok: false, error: 'Payment method name must be 1–60 characters.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const method = await findOrCreatePaymentMethod(companyId, name);
    return { ok: true, id: method.id, name: method.name };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not add the payment method.',
    };
  }
}

// Live GL sync after a bank-txn mutation. Fire-and-forget: the banking action
// must never fail because a ledger write hiccuped — the GL rebuild
// reconverges anyway.
async function syncTxnGlSafe(
  companyId: string,
  ...txnIds: (string | null | undefined)[]
): Promise<void> {
  for (const id of txnIds) {
    if (!id) continue;
    try {
      await syncBankTxnGl(companyId, id);
    } catch {
      // Swallowed by design — see above.
    }
  }
}

async function loadTxnAndUser(input: CommonMatchInput) {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { error: 'No permission.' as const };
  }
  const companyId = await getActiveCompanyId();
  const txnId = matchTxnIdSchema.safeParse(input.transactionId);
  if (!txnId.success) return { error: 'Invalid transaction id.' as const };
  const txn = await getImportedTransaction(companyId, txnId.data);
  if (!txn) return { error: 'Transaction not found.' as const };
  if (txn.isIgnored) {
    return { error: 'Transaction is ignored — un-ignore before matching.' as const };
  }
  if (txn.reconciledAt) {
    return { error: 'Transaction is already reconciled. Unmatch first.' as const };
  }
  return { user, companyId, txn };
}

// A deposit is "fully allocated" once the matched payments cover it within
// this tolerance — absorbs cent-rounding and tiny wire/bank-fee differences
// (e.g. a $110,695.18 deposit vs $110,695.20 of invoices). A real shortfall
// larger than this leaves the deposit partially matched for follow-up.
const RECONCILE_TOLERANCE = 1.0;

/**
 * Match one bank deposit to ONE OR MORE invoice payments — a lump customer
 * payment covering several invoices. Validates each payment, sums them against
 * the deposit, and reconciles only when the running allocation covers the
 * deposit (within RECONCILE_TOLERANCE). Under-allocated deposits stay open so
 * the operator can keep adding invoices until the remainder hits zero.
 */
export async function matchInvoicePaymentsAction(input: {
  transactionId: string;
  invoicePaymentIds: string[];
  confidence?: 'exact' | 'high' | 'low' | 'manual';
}): Promise<{
  ok: boolean;
  error?: string;
  reconciled?: boolean;
  remaining?: number;
}> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;

  const deposit = Number(txn.amount);
  if (deposit <= 0) {
    return {
      ok: false,
      error: 'Invoice payments only match money-in (positive) bank transactions.',
    };
  }

  const ids = Array.from(
    new Set((input.invoicePaymentIds ?? []).filter((x) => typeof x === 'string' && x)),
  );
  if (ids.length === 0) {
    return { ok: false, error: 'Select at least one invoice to match.' };
  }

  // Sum the newly-selected payments.
  let newSum = 0;
  for (const id of ids) {
    const p = await getPayment(companyId, id);
    if (!p) {
      return { ok: false, error: 'One of the selected invoice payments was not found.' };
    }
    newSum += Number(p.amount);
  }

  // Add anything already matched to this deposit (incremental top-ups).
  const existing = (await listActiveMatchesForTxn(companyId, txn.id)).filter(
    (m) => m.matchType === 'invoice_payment' && m.invoicePaymentId,
  );
  let priorSum = 0;
  for (const m of existing) {
    const p = await getPayment(companyId, m.invoicePaymentId!);
    if (p) priorSum += Number(p.amount);
  }

  const allocated = Math.round((priorSum + newSum) * 100) / 100;
  const remaining = Math.round((deposit - allocated) * 100) / 100;
  const reconcile = allocated >= deposit - RECONCILE_TOLERANCE;

  try {
    await createInvoicePaymentMatchesAtomic({
      companyId,
      importedTransactionId: txn.id,
      invoicePaymentIds: ids,
      confidence: input.confidence ?? 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
      reconcile,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message.includes('duplicate')
          ? 'One of these invoice payments is already matched to a different transaction. Refresh and try again.'
          : err instanceof Error
            ? err.message
            : 'Match failed.',
    };
  }
  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return {
    ok: true,
    reconciled: reconcile,
    remaining: Math.max(0, remaining),
  };
}

export type InvoicePaymentSearchResult = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amount: number;
  paidDate: string;
  sameAmount: boolean;
};

/**
 * Manual invoice-payment search for the reconciliation match picker. Unlike
 * the ±7-day auto-suggester, this lets the operator find ANY non-void,
 * not-yet-matched invoice payment by invoice number or customer name and
 * reconcile it regardless of the date gap (then matched via
 * matchInvoicePaymentsAction with confidence 'manual'). Money-in txns only.
 */
export async function searchInvoicePaymentsForMatchAction(input: {
  transactionId: string;
  query?: string;
}): Promise<
  | { ok: true; results: InvoicePaymentSearchResult[] }
  | { ok: false; error: string }
> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const txnId = matchTxnIdSchema.safeParse(input.transactionId);
  if (!txnId.success) return { ok: false, error: 'Invalid transaction id.' };
  const txn = await getImportedTransaction(companyId, txnId.data);
  if (!txn) return { ok: false, error: 'Transaction not found.' };

  const bankAmount = Number(txn.amount);
  if (bankAmount <= 0) {
    return {
      ok: false,
      error: 'Invoice matching applies to money-in transactions only.',
    };
  }

  const [payments, invoices, projects, customers, activeMatches] =
    await Promise.all([
      listPayments(companyId), // already excludes voided-invoice payments
      listInvoices(companyId),
      listProjects(companyId),
      listCustomers(companyId),
      listActiveMatchesForCompany(companyId),
    ]);

  const taken = new Set(
    activeMatches
      .filter((m) => m.invoicePaymentId !== null)
      .map((m) => m.invoicePaymentId!),
  );
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const q = (input.query ?? '').trim().toLowerCase();
  const bankCents = Math.round(bankAmount * 100);

  const results: InvoicePaymentSearchResult[] = [];
  for (const p of payments) {
    if (taken.has(p.id)) continue;
    const inv = invoiceById.get(p.invoiceId);
    if (!inv) continue;
    const proj = inv.projectId ? projectById.get(inv.projectId) : null;
    const cust = proj ? customerById.get(proj.customerId) : null;
    const invoiceNumber = inv.number ?? '—';
    const customerName = cust?.name ?? '—';
    if (q && !`${invoiceNumber} ${customerName}`.toLowerCase().includes(q)) {
      continue;
    }
    const amount = Number(p.amount);
    results.push({
      id: p.id,
      invoiceId: p.invoiceId,
      invoiceNumber,
      customerName,
      amount,
      paidDate: p.paidDate,
      sameAmount: Math.round(amount * 100) === bankCents,
    });
  }

  // Same-amount candidates first (most likely match), then most recent.
  results.sort((a, b) => {
    if (a.sameAmount !== b.sameAmount) return a.sameAmount ? -1 : 1;
    return b.paidDate.localeCompare(a.paidDate);
  });

  return { ok: true, results: results.slice(0, 25) };
}

// ===== Deposit → invoice reconciliation (incl. already-paid invoices) =====

const r2 = (n: number) => Math.round(n * 100) / 100;

export type InvoiceReconcileSearchResult = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  total: number;
  /** Amount of this invoice NOT yet reconciled to a bank deposit
   *  (= total − payments already matched to a bank txn). Always > 0. */
  unreconciled: number;
  /** Invoice status, so the picker can show "marked paid — not on a bank
   *  deposit yet" vs "open balance". */
  status: string;
  /** unreconciled ≈ this deposit — surfaced first as the likeliest match. */
  sameAmount: boolean;
};

/** Set of invoice_payment ids that are matched to an ACTIVE bank txn. */
function bankMatchedPaymentIds(
  activeMatches: { matchType: string; invoicePaymentId: string | null }[],
): Set<string> {
  return new Set(
    activeMatches
      .filter((m) => m.matchType === 'invoice_payment' && m.invoicePaymentId)
      .map((m) => m.invoicePaymentId!),
  );
}

/**
 * For each matched invoice payment, the amount of the DEPOSIT it's matched to.
 * Deposit reconciliation is deposit-aware: a payment matched whole to a
 * SMALLER deposit (the over-run got absorbed by the reconcile tolerance) only
 * reconciles the deposit's worth — the rest (payment − deposit) is still
 * unreconciled and can be matched to a second deposit.
 */
function matchedDepositByPayment(
  activeMatches: {
    matchType: string;
    invoicePaymentId: string | null;
    importedTransactionId: string;
  }[],
  depositAmountByTxn: Map<string, number>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of activeMatches) {
    if (x.matchType === 'invoice_payment' && x.invoicePaymentId) {
      const dep = depositAmountByTxn.get(x.importedTransactionId);
      if (dep !== undefined) m.set(x.invoicePaymentId, dep);
    }
  }
  return m;
}

/** Bank money actually reconciled to a payment = min(payment, its deposit). */
function reconciledForPayment(
  paymentAmount: number,
  depositByPayment: Map<string, number>,
  paymentId: string,
): number {
  const dep = depositByPayment.get(paymentId);
  if (dep === undefined) return 0; // unmatched
  return Math.min(paymentAmount, dep);
}

/**
 * Search invoices that still have an amount NOT YET RECONCILED to a bank
 * deposit — `total − (payments already matched to a bank txn)`. This includes
 * invoices already marked PAID whose recorded payment hasn't been tied to a
 * deposit yet (the common case here), as well as genuinely open invoices.
 * Matching reconciles the deposit to those invoices (splitting a recorded
 * payment when a deposit only covers part). Money-in txns only.
 */
export async function searchInvoicesForMatchAction(input: {
  transactionId: string;
  query?: string;
}): Promise<
  | { ok: true; results: InvoiceReconcileSearchResult[] }
  | { ok: false; error: string }
> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const txnId = matchTxnIdSchema.safeParse(input.transactionId);
  if (!txnId.success) return { ok: false, error: 'Invalid transaction id.' };
  const txn = await getImportedTransaction(companyId, txnId.data);
  if (!txn) return { ok: false, error: 'Transaction not found.' };

  const bankAmount = Number(txn.amount);
  if (bankAmount <= 0) {
    return {
      ok: false,
      error: 'Invoice matching applies to money-in transactions only.',
    };
  }

  const [invoices, payments, projects, customers, activeMatches] =
    await Promise.all([
      listInvoices(companyId),
      listPayments(companyId), // excludes voided-invoice payments
      listProjects(companyId),
      listCustomers(companyId),
      listActiveMatchesForCompany(companyId),
    ]);
  // Deposit-aware: a payment matched whole to a smaller deposit only counts
  // that deposit's worth as reconciled (the over-run is still unreconciled).
  const matchedTxnIds = Array.from(
    new Set(
      activeMatches
        .filter((m) => m.matchType === 'invoice_payment' && m.invoicePaymentId)
        .map((m) => m.importedTransactionId),
    ),
  );
  const depositAmountByTxn = await getImportedTransactionAmounts(
    companyId,
    matchedTxnIds,
  );
  const depositByPayment = matchedDepositByPayment(
    activeMatches,
    depositAmountByTxn,
  );
  // Bank-reconciled amount per invoice = sum of min(payment, its deposit).
  const reconciledByInvoice = new Map<string, number>();
  for (const p of payments) {
    const covered = reconciledForPayment(Number(p.amount), depositByPayment, p.id);
    if (covered > 0) {
      reconciledByInvoice.set(
        p.invoiceId,
        (reconciledByInvoice.get(p.invoiceId) ?? 0) + covered,
      );
    }
  }
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const q = (input.query ?? '').trim().toLowerCase();
  const bankCents = Math.round(bankAmount * 100);

  const results: InvoiceReconcileSearchResult[] = [];
  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    const total = Number(inv.total);
    const unreconciled = r2(total - (reconciledByInvoice.get(inv.id) ?? 0));
    if (unreconciled <= 0.005) continue; // fully reconciled to the bank
    const proj = inv.projectId ? projectById.get(inv.projectId) : null;
    const cust = proj ? customerById.get(proj.customerId) : null;
    const invoiceNumber = inv.number ?? '—';
    const customerName = cust?.name ?? '—';
    if (q && !`${invoiceNumber} ${customerName}`.toLowerCase().includes(q)) {
      continue;
    }
    results.push({
      invoiceId: inv.id,
      invoiceNumber,
      customerName,
      total,
      unreconciled,
      status: inv.status,
      sameAmount: Math.round(unreconciled * 100) === bankCents,
    });
  }

  // Likeliest single match first (unreconciled == deposit), then biggest.
  results.sort((a, b) => {
    if (a.sameAmount !== b.sameAmount) return a.sameAmount ? -1 : 1;
    return b.unreconciled - a.unreconciled;
  });

  return { ok: true, results: results.slice(0, 25) };
}

/**
 * Reconcile a deposit to one or more invoices. For each ticked invoice (in
 * order) we apply the lesser of its unreconciled amount and the deposit's
 * remaining, by first consuming its recorded-but-unreconciled payments (oldest
 * first, splitting the one the deposit only partly covers) and finally creating
 * a payment for any genuine open balance. Reconciles the deposit when fully
 * allocated. An invoice's total/paid status is unchanged by a pure
 * reconciliation — it just gains the bank linkage.
 */
export async function matchInvoiceBalancesAction(input: {
  transactionId: string;
  invoiceIds: string[];
}): Promise<{
  ok: boolean;
  error?: string;
  reconciled?: boolean;
  remaining?: number;
}> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;

  const deposit = Number(txn.amount);
  if (deposit <= 0) {
    return {
      ok: false,
      error: 'Invoice payments only match money-in (positive) bank transactions.',
    };
  }

  const ids = Array.from(
    new Set((input.invoiceIds ?? []).filter((x) => typeof x === 'string' && x)),
  );
  if (ids.length === 0) {
    return { ok: false, error: 'Select at least one invoice to match.' };
  }

  const [invoices, payments, activeMatches] = await Promise.all([
    listInvoices(companyId),
    listPayments(companyId),
    listActiveMatchesForCompany(companyId),
  ]);
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const matchedPaymentIds = bankMatchedPaymentIds(activeMatches);
  const matchedTxnIds = Array.from(
    new Set(
      activeMatches
        .filter((m) => m.matchType === 'invoice_payment' && m.invoicePaymentId)
        .map((m) => m.importedTransactionId),
    ),
  );
  const depositAmountByTxn = await getImportedTransactionAmounts(
    companyId,
    matchedTxnIds,
  );
  const depositByPayment = matchedDepositByPayment(
    activeMatches,
    depositAmountByTxn,
  );
  const paymentsByInvoice = new Map<string, typeof payments>();
  for (const p of payments) {
    const arr = paymentsByInvoice.get(p.invoiceId) ?? [];
    arr.push(p);
    paymentsByInvoice.set(p.invoiceId, arr);
  }

  // What this deposit has already reconciled (sum of its prior matched payments).
  const priorMatches = activeMatches.filter(
    (m) =>
      m.importedTransactionId === txn.id &&
      m.matchType === 'invoice_payment' &&
      m.invoicePaymentId,
  );
  let alreadyAllocated = 0;
  for (const m of priorMatches) {
    const p = payments.find((x) => x.id === m.invoicePaymentId);
    if (p) alreadyAllocated += Number(p.amount);
  }
  let depositRemaining = r2(deposit - alreadyAllocated);
  if (depositRemaining <= 0.005) {
    return { ok: false, error: 'This deposit is already fully allocated.' };
  }

  const ops: ReconcileOp[] = [];
  let totalApplied = 0;
  for (const invoiceId of ids) {
    if (depositRemaining <= 0.005) break;
    const inv = invById.get(invoiceId);
    if (!inv || inv.status === 'void') {
      return { ok: false, error: 'One of the selected invoices was not found.' };
    }
    const invPays = paymentsByInvoice.get(invoiceId) ?? [];
    // Deposit-aware: a matched payment only reconciles its deposit's worth.
    const bankReconciled = invPays.reduce(
      (s, p) =>
        s + reconciledForPayment(Number(p.amount), depositByPayment, p.id),
      0,
    );
    const unreconciled = r2(Number(inv.total) - bankReconciled);
    if (unreconciled <= 0.005) continue;
    const applied = r2(Math.min(unreconciled, depositRemaining));
    if (applied <= 0.005) continue;

    // Consume recorded-but-unreconciled payments first (oldest first); split
    // the one the deposit only partly covers. Then create for any open balance.
    let need = applied;
    const unmatched = invPays
      .filter(
        (p) =>
          !matchedPaymentIds.has(p.id) &&
          (p.status === 'received' || p.status === 'applied'),
      )
      .sort((a, b) => a.paidDate.localeCompare(b.paidDate));
    for (const p of unmatched) {
      if (need <= 0.005) break;
      const pAmt = r2(Number(p.amount));
      if (pAmt <= 0.005) continue;
      const take = r2(Math.min(pAmt, need));
      if (Math.abs(take - pAmt) < 0.005) {
        ops.push({ type: 'match_existing', invoiceId, paymentId: p.id });
      } else {
        ops.push({
          type: 'split_and_match',
          invoiceId,
          paymentId: p.id,
          matchAmount: take,
          remainderAmount: r2(pAmt - take),
        });
      }
      need = r2(need - take);
    }
    // Then peel off any OVER-ALLOCATED residual: a payment matched whole to a
    // smaller deposit (tolerance over-run) — split that excess to this deposit.
    if (need > 0.005) {
      const overMatched = invPays
        .filter((p) => depositByPayment.has(p.id))
        .map((p) => ({
          p,
          residual: r2(Number(p.amount) - (depositByPayment.get(p.id) ?? 0)),
        }))
        .filter((x) => x.residual > 0.005)
        .sort((a, b) => b.residual - a.residual);
      for (const { p, residual } of overMatched) {
        if (need <= 0.005) break;
        const take = r2(Math.min(residual, need));
        if (take <= 0.005) continue;
        ops.push({ type: 'split_overmatched', invoiceId, paymentId: p.id, amount: take });
        need = r2(need - take);
      }
    }
    if (need > 0.005) {
      ops.push({ type: 'create_and_match', invoiceId, amount: need });
    }

    totalApplied = r2(totalApplied + applied);
    depositRemaining = r2(depositRemaining - applied);
  }

  if (ops.length === 0) {
    return {
      ok: false,
      error:
        'Nothing to reconcile — the selected invoices are already fully reconciled to the bank.',
    };
  }

  const totalAllocated = r2(alreadyAllocated + totalApplied);
  const reconcile = totalAllocated >= deposit - RECONCILE_TOLERANCE;
  const bank = await getBankAccount(companyId, txn.bankAccountId);

  try {
    await reconcileInvoicesToDepositAtomic({
      companyId,
      importedTransactionId: txn.id,
      ops,
      paidDate: txn.transactionDate,
      bankAccountLabel: bank?.name ?? null,
      confidence: 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
      reconcile,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Match failed.',
    };
  }

  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return {
    ok: true,
    reconciled: reconcile,
    remaining: Math.max(0, r2(deposit - totalAllocated)),
  };
}

// ===== AP: batch bill payment (one withdrawal → many bills + bank fee) =====

export type BillSearchResult = {
  /** A vendor bill (posted receipt) or a payroll bill (net-pay payable). */
  kind: 'receipt' | 'payroll_bill';
  id: string;
  label: string;
  total: number;
  date: string;
  sameAmount: boolean;
};

/** Open bills — posted vendor receipts AND payroll bills — not yet matched,
 *  for the batch bill-payment picker. Money-out transactions only. */
export async function searchBillsForMatchAction(input: {
  transactionId: string;
  query?: string;
}): Promise<
  { ok: true; results: BillSearchResult[] } | { ok: false; error: string }
> {
  await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  const txnId = matchTxnIdSchema.safeParse(input.transactionId);
  if (!txnId.success) return { ok: false, error: 'Invalid transaction id.' };
  const txn = await getImportedTransaction(companyId, txnId.data);
  if (!txn) return { ok: false, error: 'Transaction not found.' };
  if (Number(txn.amount) >= 0) {
    return { ok: false, error: 'Bills match money-out transactions only.' };
  }
  const absCents = Math.round(Math.abs(Number(txn.amount)) * 100);

  const [receipts, vendors, activeMatches, payrollBillsOpen, employees] =
    await Promise.all([
      listReceipts(companyId, { status: 'posted', limit: 1000 }),
      listVendors(companyId),
      listActiveMatchesForCompany(companyId),
      listOpenPayrollBills(companyId),
      listEmployees(companyId),
    ]);
  const takenReceipts = new Set(
    activeMatches.filter((m) => m.receiptId).map((m) => m.receiptId!),
  );
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const q = (input.query ?? '').trim().toLowerCase();

  // Applied vendor credits reduce what the bank payment covers — offer bills
  // at their NET due (bill − credits), same as the single-receipt matcher.
  const appliedCredits = await sumAppliedCreditsByReceipt(
    companyId,
    receipts.map((r) => r.id),
  );

  const results: BillSearchResult[] = [];
  for (const r of receipts) {
    if (takenReceipts.has(r.id)) continue;
    // Cash receipts are paid on the spot (credited Cash on Hand, not A/P), so
    // there's no bank payment to match — keep them out of the bills picker.
    if (r.paymentSourceType === 'cash') continue;
    const vendorName = r.vendorId
      ? (vendorById.get(r.vendorId)?.name ?? '—')
      : '—';
    if (q && !vendorName.toLowerCase().includes(q)) continue;
    const credit = appliedCredits.get(r.id) ?? 0;
    const total = Math.round((Number(r.total) - credit) * 100) / 100;
    // The vendor's invoice number is how Chris/Olga recognize a bill when
    // matching a payment — surface it in the picker label.
    const invTag = r.vendorInvoiceNumber ? ` · #${r.vendorInvoiceNumber}` : '';
    results.push({
      kind: 'receipt',
      id: r.id,
      label: `${vendorName}${invTag}${credit > 0 ? ' (net of credit)' : ''}`,
      total,
      date: r.receiptDate,
      sameAmount: Math.round(total * 100) === absCents,
    });
  }
  for (const b of payrollBillsOpen) {
    const emp = employeeById.get(b.employeeId);
    const name = emp ? `${emp.firstName} ${emp.lastName}`.trim() : 'Employee';
    const label = `${name} (payroll)`;
    if (q && !label.toLowerCase().includes(q)) continue;
    const net = Number(b.net);
    results.push({
      kind: 'payroll_bill',
      id: b.id,
      label,
      total: net,
      date: b.billDate,
      sameAmount: Math.round(net * 100) === absCents,
    });
  }
  results.sort((a, b) => {
    if (a.sameAmount !== b.sameAmount) return a.sameAmount ? -1 : 1;
    return b.date.localeCompare(a.date);
  });
  return { ok: true, results: results.slice(0, 60) };
}

export async function matchBillsAction(input: {
  transactionId: string;
  receiptIds?: string[];
  payrollBillIds?: string[];
  feeAccountId?: string | null;
  confidence?: 'exact' | 'high' | 'low' | 'manual';
}): Promise<{
  ok: boolean;
  error?: string;
  reconciled?: boolean;
  remaining?: number;
  fee?: number;
}> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;

  const withdrawal = Number(txn.amount);
  if (withdrawal >= 0) {
    return {
      ok: false,
      error: 'Bills only match money-out (negative) bank transactions.',
    };
  }
  const abs = Math.round(Math.abs(withdrawal) * 100) / 100;

  const receiptIds = Array.from(
    new Set((input.receiptIds ?? []).filter((x) => typeof x === 'string' && x)),
  );
  const payrollBillIds = Array.from(
    new Set(
      (input.payrollBillIds ?? []).filter((x) => typeof x === 'string' && x),
    ),
  );
  if (receiptIds.length + payrollBillIds.length === 0) {
    return { ok: false, error: 'Select at least one bill to match.' };
  }

  // Bills count at their NET due (total − applied vendor credits) — a payment
  // of (bill − credit) must reconcile without a phantom shortfall.
  const creditByReceipt = await sumAppliedCreditsByReceipt(companyId, [
    ...receiptIds,
  ]);

  let newSum = 0;
  for (const id of receiptIds) {
    const r = await getReceipt(companyId, id);
    if (!r) return { ok: false, error: 'One of the selected bills was not found.' };
    if (r.status !== 'posted') {
      return { ok: false, error: 'Only posted bills can be matched.' };
    }
    newSum += Number(r.total) - (creditByReceipt.get(id) ?? 0);
  }
  for (const id of payrollBillIds) {
    const b = await getPayrollBill(companyId, id);
    if (!b) return { ok: false, error: 'One of the selected payroll bills was not found.' };
    if (b.status !== 'open') {
      return { ok: false, error: 'That payroll bill is already paid.' };
    }
    newSum += Number(b.net);
  }

  // Add anything already matched to this withdrawal (incremental top-ups) —
  // also at net-of-credit value.
  const existing = await listActiveMatchesForTxn(companyId, txn.id);
  const priorReceiptIds = existing
    .filter((m) => m.matchType === 'receipt' && m.receiptId)
    .map((m) => m.receiptId!);
  const priorCredits = await sumAppliedCreditsByReceipt(
    companyId,
    priorReceiptIds,
  );
  let priorSum = 0;
  for (const m of existing) {
    if (m.matchType === 'receipt' && m.receiptId) {
      const r = await getReceipt(companyId, m.receiptId);
      if (r) priorSum += Number(r.total) - (priorCredits.get(r.id) ?? 0);
    } else if (m.matchType === 'payroll_bill' && m.payrollBillId) {
      const b = await getPayrollBill(companyId, m.payrollBillId);
      if (b) priorSum += Number(b.net);
    }
  }

  const allocated = Math.round((priorSum + newSum) * 100) / 100;
  const remaining = Math.round((abs - allocated) * 100) / 100;

  // Any shortfall is the bank/transaction fee — an expense on the payment date
  // — when the operator picks a fee account. Otherwise reconcile only within
  // the cent tolerance.
  let fee: { accountingAccountId: string; amount: number } | null = null;
  if (remaining > RECONCILE_TOLERANCE && input.feeAccountId) {
    fee = { accountingAccountId: input.feeAccountId, amount: remaining };
  }
  const feeAmount = fee ? fee.amount : 0;
  const reconcile = allocated + feeAmount >= abs - RECONCILE_TOLERANCE;

  try {
    await createReceiptMatchesAtomic({
      companyId,
      importedTransactionId: txn.id,
      receiptIds,
      payrollBillIds,
      fee,
      confidence: input.confidence ?? 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
      reconcile,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message.includes('duplicate')
          ? 'One of these bills is already matched to a different transaction. Refresh and try again.'
          : err instanceof Error
            ? err.message
            : 'Match failed.',
    };
  }
  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return {
    ok: true,
    reconciled: reconcile,
    remaining: Math.max(0, Math.round((abs - allocated - feeAmount) * 100) / 100),
    fee: feeAmount,
  };
}

export async function matchReceiptAction(input: {
  transactionId: string;
  receiptId: string;
  confidence?: 'exact' | 'high' | 'low' | 'manual';
}): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;
  const receipt = await getReceipt(companyId, input.receiptId);
  if (!receipt) return { ok: false, error: 'Receipt not found.' };
  if (receipt.status !== 'posted') {
    return { ok: false, error: 'Only posted receipts can be matched.' };
  }
  if (Number(txn.amount) >= 0) {
    return {
      ok: false,
      error: 'Receipts only match money-out (negative) bank transactions.',
    };
  }
  try {
    await createMatchAtomic({
      companyId,
      importedTransactionId: txn.id,
      matchType: 'receipt',
      receiptId: input.receiptId,
      confidence: input.confidence ?? 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message.includes('duplicate')
          ? 'This receipt is already matched to a different transaction.'
          : err instanceof Error
            ? err.message
            : 'Match failed.',
    };
  }
  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
}

/**
 * "Add receipt" on a bank transaction: create a documentary DRAFT receipt
 * prefilled from the bank line and link it as the line's proof-of-purchase.
 * The operator then uploads the picture(s) (the receipt page's existing
 * multi-image uploader) and posts it later with project / cost code.
 *
 * Why a draft, not a posted receipt: posting requires a line with project +
 * cost code (it writes a job_cost_entry), which would force categorization at
 * upload time and could double-count if the bank line is already job-tagged.
 * The documentary draft keeps "attach a receipt photo" fast. We link via the
 * match primitive directly so matchReceiptAction's strict posted-only guard
 * (used by the auto-suggest path) stays intact.
 */
export async function addReceiptToTransactionAction(input: {
  transactionId: string;
}): Promise<{ ok: boolean; receiptId?: string; error?: string }> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;
  if (Number(txn.amount) >= 0) {
    return {
      ok: false,
      error: 'Receipts attach to money-out (debit) transactions.',
    };
  }
  const company = await getActiveCompany();
  const account = txn.bankAccountId
    ? await getBankAccount(companyId, txn.bankAccountId)
    : null;
  const gross = toMoneyString(Math.abs(Number(txn.amount)));
  let receiptId: string;
  try {
    const receipt = await createReceipt({
      companyId,
      receiptDate: txn.transactionDate,
      currency: txn.currency,
      // Header total reflects the bank line; line-level detail (and any VAT
      // split) is added on the receipt page before posting.
      subtotal: gross,
      vatAmount: '0',
      total: gross,
      vatRatePercent:
        company.isVatActive && company.vatRatePercent
          ? company.vatRatePercent
          : null,
      vendorId: txn.vendorId ?? null,
      bankAccountId: txn.bankAccountId ?? null,
      paymentSourceType: account?.type === 'credit_card' ? 'credit_card' : 'bank',
      status: 'draft',
      notes: `From bank transaction: ${txn.description}`.slice(0, 500),
      uploadedByUserId: user.id,
    });
    receiptId = receipt.id;
    await createMatchAtomic({
      companyId,
      importedTransactionId: txn.id,
      matchType: 'receipt',
      receiptId: receipt.id,
      confidence: 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
      notes: 'Receipt added from bank transaction',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Could not add receipt: ${message}` };
  }
  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true, receiptId };
}

export async function matchJobCostEntryAction(input: {
  transactionId: string;
  jobCostEntryId: string;
  confidence?: 'exact' | 'high' | 'low' | 'manual';
}): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;
  try {
    await createMatchAtomic({
      companyId,
      importedTransactionId: txn.id,
      matchType: 'job_cost_entry',
      jobCostEntryId: input.jobCostEntryId,
      confidence: input.confidence ?? 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message.includes('duplicate')
          ? 'This job cost entry is already matched to a different transaction.'
          : err instanceof Error
            ? err.message
            : 'Match failed.',
    };
  }
  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
}

export async function matchTransferAction(input: {
  transactionId: string;
  pairedTransactionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;
  const pairedId = matchTxnIdSchema.safeParse(input.pairedTransactionId);
  if (!pairedId.success) return { ok: false, error: 'Invalid paired txn id.' };
  if (pairedId.data === txn.id) {
    return { ok: false, error: 'Pair must be a different transaction.' };
  }
  const paired = await getImportedTransaction(companyId, pairedId.data);
  if (!paired) return { ok: false, error: 'Paired transaction not found.' };
  if (paired.reconciledAt) {
    return { ok: false, error: 'Paired transaction is already reconciled.' };
  }
  if (paired.bankAccountId === txn.bankAccountId) {
    return { ok: false, error: 'Transfer must be between different accounts.' };
  }
  // Sanity: opposite signs, same absolute amount.
  const a = Number(txn.amount);
  const b = Number(paired.amount);
  if (a * b >= 0) {
    return {
      ok: false,
      error: 'Transfer requires one debit and one credit (opposite signs).',
    };
  }
  if (Math.round(Math.abs(a) * 100) !== Math.round(Math.abs(b) * 100)) {
    return { ok: false, error: 'Transfer amounts must match.' };
  }
  try {
    await createTransferPairAtomic({
      companyId,
      txnAId: txn.id,
      txnBId: paired.id,
      matchedByUserId: await safeMatchUserId(user.id),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Transfer match failed.',
    };
  }
  await syncTxnGlSafe(companyId, txn.id, paired.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  revalidatePath(`/banking/accounts/${paired.bankAccountId}`);
  return { ok: true };
}

/**
 * Single-sided transfer: the money moved to/from an account that isn't loaded
 * in KrakenOps (e.g. "Transfer To Acct 201759772"), so there's no opposite
 * line to pair with. Books it to the "Inter-account Transfers" clearing
 * account (a balance-sheet asset) so it leaves the to-do AND stays out of the
 * P&L — a transfer is not income or expense. Reconciles the txn as a transfer.
 */
export async function markInterAccountTransferAction(input: {
  transactionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;

  const accounts = await listAccountingAccounts(companyId);
  const clearing = accounts.find(
    (a) => a.name === 'Inter-account Transfers' && !a.isArchived,
  );
  if (!clearing) {
    return {
      ok: false,
      error:
        'No "Inter-account Transfers" account found. Add one (Asset) under accounting categories first.',
    };
  }

  try {
    await createMatchAtomic({
      companyId,
      importedTransactionId: txn.id,
      matchType: 'transfer',
      confidence: 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not mark as transfer.',
    };
  }

  // Categorize to the clearing account so the GL posts it to the balance sheet
  // (not Uncategorized Expense). Don't overwrite an existing category.
  if (!txn.accountingAccountId) {
    await updateImportedTransaction(companyId, txn.id, {
      accountingAccountId: clearing.id,
    });
  }

  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
}

/** Owner contribution (money in) or owner draw (money out). No FK target —
 *  these are categorization-only matches. Also pre-fills the bank txn's
 *  category to owner_equity if a COA row exists for it. */
export async function matchOwnerEquityAction(input: {
  transactionId: string;
  kind: 'owner_contribution' | 'owner_draw';
}): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;
  const a = Number(txn.amount);
  if (input.kind === 'owner_contribution' && a <= 0) {
    return { ok: false, error: 'Owner contributions must be money-in.' };
  }
  if (input.kind === 'owner_draw' && a >= 0) {
    return { ok: false, error: 'Owner draws must be money-out.' };
  }

  // Look up the seeded Owner's Equity account so we can also populate the
  // bank txn's accountingAccountId. If it doesn't exist (shouldn't happen
  // after Phase 1 COA seed), proceed without categorization.
  const accounts = await listAccountingAccounts(companyId);
  const equity = accounts.find((x) => x.type === 'owner_equity');

  try {
    await createMatchAtomic({
      companyId,
      importedTransactionId: txn.id,
      matchType: input.kind,
      confidence: 'manual',
      matchedByUserId: await safeMatchUserId(user.id),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Match failed.',
    };
  }

  // Best-effort: tag the bank txn's accounting category. If a category was
  // already set we leave it — same Phase-1 "don't overwrite human work" rule.
  if (equity && !txn.accountingAccountId) {
    await updateImportedTransaction(companyId, txn.id, {
      accountingAccountId: equity.id,
    });
  }

  await syncTxnGlSafe(companyId, txn.id);
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
}

export async function unmatchTransactionAction(input: {
  transactionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();
  // A deposit may carry several invoice_payment matches — reverse them all so
  // "Unmatch" fully unlinks the transaction (every other type is one-per-txn).
  const matches = await listActiveMatchesForTxn(companyId, input.transactionId);
  if (matches.length === 0) {
    return { ok: false, error: 'No active match to reverse.' };
  }
  for (const match of matches) {
    await reverseMatchAtomic({
      companyId,
      matchId: match.id,
      reversedByUserId: user.id,
    });
  }
  await syncTxnGlSafe(
    companyId,
    input.transactionId,
    // A reversed transfer frees the paired transaction too.
    ...matches.map((m) => m.transferPairedTxnId),
  );
  revalidatePath(`/banking/accounts/`);
  return { ok: true };
}

export type BulkAutoMatchResult =
  | {
      ok: true;
      matched: number;
      scanned: number;
    }
  | { ok: false; error: string };

/** Apply every EXACT match (amount+date both equal) for unreconciled,
 *  non-ignored txns in this bank account. Honors the same unique-constraint
 *  contracts as single-row Match — concurrent matches on the same target
 *  are skipped silently. */
export async function bulkAutoMatchExactAction(input: {
  bankAccountId: string;
}): Promise<BulkAutoMatchResult> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!can(role, 'statement_imports', 'create')) {
    return { ok: false, error: 'No permission.' };
  }
  const companyId = await getActiveCompanyId();

  // Load the candidate sets once.
  const [txns, payments, postedReceipts, activeMatches, invoices, allReceipts] =
    await Promise.all([
      // Reuse listImportedTransactions filtered to this account.
      // We import it locally to avoid cycles.
      (await import('@/lib/data/statement-imports')).listImportedTransactions(
        companyId,
        {
          bankAccountId: input.bankAccountId,
          includeIgnored: false,
          limit: 1000,
        },
      ),
      listPayments(companyId),
      listReceipts(companyId, { status: 'posted', limit: 1000 }),
      listActiveMatchesForCompany(companyId),
      listInvoices(companyId),
      listReceipts(companyId, { limit: 1000 }),
    ]);

  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const receiptById = new Map(allReceipts.map((r) => [r.id, r]));
  void receiptById;
  void invoiceById;

  const takenInvoicePayment = new Set(
    activeMatches
      .filter((m) => m.invoicePaymentId !== null)
      .map((m) => m.invoicePaymentId!),
  );
  const takenReceipt = new Set(
    activeMatches.filter((m) => m.receiptId !== null).map((m) => m.receiptId!),
  );
  // Exact-match receipts at NET due (total − applied vendor credits).
  const bulkCredits = await sumAppliedCreditsByReceipt(
    companyId,
    postedReceipts.map((r) => r.id),
  );

  let matched = 0;
  const matchedTxnIds: string[] = [];
  for (const txn of txns) {
    if (txn.reconciledAt) continue;
    if (txn.isIgnored) continue;
    const amt = Number(txn.amount);
    const absAmt = Math.round(Math.abs(amt) * 100);

    // Exact match = same date AND same absolute amount.
    if (amt > 0) {
      const cand = payments.find(
        (p) =>
          !takenInvoicePayment.has(p.id) &&
          p.paidDate === txn.transactionDate &&
          Math.round(Math.abs(Number(p.amount)) * 100) === absAmt,
      );
      if (cand) {
        try {
          await createMatchAtomic({
            companyId,
            importedTransactionId: txn.id,
            matchType: 'invoice_payment',
            invoicePaymentId: cand.id,
            confidence: 'exact',
            matchedByUserId: await safeMatchUserId(user.id),
          });
          takenInvoicePayment.add(cand.id);
          matched += 1;
          matchedTxnIds.push(txn.id);
        } catch {
          // Race: another match landed first. Skip silently.
        }
        continue;
      }
    } else if (amt < 0) {
      const cand = postedReceipts.find(
        (r) =>
          !takenReceipt.has(r.id) &&
          r.receiptDate === txn.transactionDate &&
          Math.round(
            Math.abs(Number(r.total) - (bulkCredits.get(r.id) ?? 0)) * 100,
          ) === absAmt,
      );
      if (cand) {
        try {
          await createMatchAtomic({
            companyId,
            importedTransactionId: txn.id,
            matchType: 'receipt',
            receiptId: cand.id,
            confidence: 'exact',
            matchedByUserId: await safeMatchUserId(user.id),
          });
          takenReceipt.add(cand.id);
          matched += 1;
          matchedTxnIds.push(txn.id);
        } catch {
          /* skip */
        }
        continue;
      }
    }
  }

  await syncTxnGlSafe(companyId, ...matchedTxnIds);
  revalidatePath(`/banking/accounts/${input.bankAccountId}`);
  return { ok: true, matched, scanned: txns.length };
}
