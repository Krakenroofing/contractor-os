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
} from '@/lib/data/bank-accounts';
import {
  createImportBatch,
  deleteImportBatch,
  getImportBatch,
  updateImportBatch,
  upsertMapping,
} from '@/lib/data/statement-imports';
import {
  bulkApplyRuleToTransactions,
  getImportedTransaction,
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
  createMatchAtomic,
  createTransferPairAtomic,
  getActiveMatchForTxn,
  listActiveMatchesForCompany,
  reverseMatchAtomic,
} from '@/lib/data/transaction-matches';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { getPayment, listPayments } from '@/lib/data/invoice-payments';
import { listInvoices } from '@/lib/data/invoices';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { getReceipt, listReceipts } from '@/lib/data/receipts';
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
  upsertRuleSchema,
} from './schema';
import {
  type MatchReason,
  type RuleForMatching,
  matchRule,
  toRuleForMatching,
  toTxnForMatching,
} from './lib/rules';

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
// coerced from string|number and must be a positive money value; the per-line
// total is validated against the parent's gross in the action.
const splitLineParseSchema = z.object({
  accountingAccountId: z.string().uuid('Pick a category for every line'),
  projectId: z.union([z.string(), z.null()]).optional(),
  costCodeId: z.union([z.string(), z.null()]).optional(),
  description: z.union([z.string().max(500), z.null()]).optional(),
  amount: z.coerce.number().finite().positive(),
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
        formError: 'Each split line needs a category and an amount greater than zero.',
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
    await replaceImportedTransactionLines(companyId, parsed.data.id, []);
    await updateImportedTransaction(companyId, parsed.data.id, {
      accountingAccountId: parsed.data.accountingAccountId,
      projectId: parsed.data.projectId,
      costCodeId: parsed.data.costCodeId,
      ...commonPatch,
    });
  }

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
  const patch =
    input.flag === 'reviewed'
      ? { isReviewed: input.value }
      : { isIgnored: input.value };
  const updated = await updateImportedTransaction(companyId, input.id, patch);
  if (!updated) return { ok: false, error: 'Transaction not found.' };
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
    bankAccountId: formData.get('bankAccountId') ?? '',
    amountMin: formData.get('amountMin') ?? '',
    amountMax: formData.get('amountMax') ?? '',
    matchers,
    actions: {
      accountingAccountId: formData.get('action_accountingAccountId') ?? '',
      projectId: formData.get('action_projectId') ?? '',
      costCodeId: formData.get('action_costCodeId') ?? '',
      notes: formData.get('action_notes') ?? '',
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

  const values = {
    companyId,
    name: d.name,
    enabled: d.enabled ?? true,
    priority: d.priority,
    appliesTo: d.appliesTo,
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

  const a = ruleForMatch.actions;
  const ruleNoteSuffix = `\n— rule: ${rule.name}`;
  const newNotes = a.notes
    ? `${a.notes}${ruleNoteSuffix}`
    : (txn.notes ?? '') + ruleNoteSuffix;

  await updateImportedTransaction(companyId, txn.id, {
    accountingAccountId: a.accountingAccountId ?? null,
    projectId: a.projectId ?? null,
    costCodeId: a.costCodeId ?? null,
    notes: newNotes.trim(),
    appliedRuleId: rule.id,
    appliedRuleAt: new Date(),
  });
  await bumpMatchCount(companyId, rule.id);

  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
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

  const a = ruleForMatch.actions;
  const noteSuffix = `\n— rule: ${rule.name}`;
  const newNotes = ((a.notes ?? '') + noteSuffix).trim();

  const applied = await bulkApplyRuleToTransactions(
    companyId,
    rule.id,
    targetIds,
    {
      accountingAccountId: a.accountingAccountId ?? null,
      projectId: a.projectId ?? null,
      costCodeId: a.costCodeId ?? null,
      notes: newNotes,
      appliedRuleId: rule.id,
      appliedRuleAt: new Date(),
    },
  );

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

export async function matchInvoicePaymentAction(input: {
  transactionId: string;
  invoicePaymentId: string;
  confidence?: 'exact' | 'high' | 'low' | 'manual';
}): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadTxnAndUser(input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { user, companyId, txn } = loaded;
  const payment = await getPayment(companyId, input.invoicePaymentId);
  if (!payment) return { ok: false, error: 'Invoice payment not found.' };
  // Sanity: bank txn must be money-in (positive) to match an invoice payment.
  if (Number(txn.amount) <= 0) {
    return {
      ok: false,
      error: 'Invoice payments only match money-in (positive) bank transactions.',
    };
  }
  try {
    await createMatchAtomic({
      companyId,
      importedTransactionId: txn.id,
      matchType: 'invoice_payment',
      invoicePaymentId: input.invoicePaymentId,
      confidence: input.confidence ?? 'manual',
      matchedByUserId: user.id,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message.includes('duplicate')
          ? 'This invoice payment is already matched to a different transaction.'
          : err instanceof Error
            ? err.message
            : 'Match failed.',
    };
  }
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
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
 * matchInvoicePaymentAction with confidence 'manual'). Money-in txns only.
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
      matchedByUserId: user.id,
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
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  return { ok: true };
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
      matchedByUserId: user.id,
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
      matchedByUserId: user.id,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Transfer match failed.',
    };
  }
  revalidatePath(`/banking/accounts/${txn.bankAccountId}`);
  revalidatePath(`/banking/accounts/${paired.bankAccountId}`);
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
      matchedByUserId: user.id,
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
  const match = await getActiveMatchForTxn(companyId, input.transactionId);
  if (!match) return { ok: false, error: 'No active match to reverse.' };
  await reverseMatchAtomic({
    companyId,
    matchId: match.id,
    reversedByUserId: user.id,
  });
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

  let matched = 0;
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
            matchedByUserId: user.id,
          });
          takenInvoicePayment.add(cand.id);
          matched += 1;
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
          Math.round(Math.abs(Number(r.total)) * 100) === absAmt,
      );
      if (cand) {
        try {
          await createMatchAtomic({
            companyId,
            importedTransactionId: txn.id,
            matchType: 'receipt',
            receiptId: cand.id,
            confidence: 'exact',
            matchedByUserId: user.id,
          });
          takenReceipt.add(cand.id);
          matched += 1;
        } catch {
          /* skip */
        }
        continue;
      }
    }
  }

  revalidatePath(`/banking/accounts/${input.bankAccountId}`);
  return { ok: true, matched, scanned: txns.length };
}
