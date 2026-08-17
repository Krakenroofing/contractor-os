import { Fragment } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { getBankAccount } from '@/lib/data/bank-accounts';
import {
  countImportedTransactions,
  getRunningBalancesForAccount,
  listImportedTransactions,
  listLinesForTransactionIds,
} from '@/lib/data/statement-imports';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listBankingRules } from '@/lib/data/banking-rules';
import { listPayments } from '@/lib/data/invoice-payments';
import { listInvoices } from '@/lib/data/invoices';
import {
  listReceipts,
  countAttachmentsByReceiptIds,
} from '@/lib/data/receipts';
import { listVendors } from '@/lib/data/vendors';
import { listCustomers } from '@/lib/data/customers';
import { listAllJobCostEntriesForCompany } from '@/lib/data/job-cost-entries';
import { listActiveMatchesForCompany } from '@/lib/data/transaction-matches';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listBankReconciliations } from '@/lib/data/bank-reconciliations';
import { sumAppliedCreditsByReceipt } from '@/lib/data/vendor-credits';
import { TransactionRowForm } from '@/modules/banking/components/transaction-row-form';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import { TransactionRulePanel } from '@/modules/banking/components/transaction-rule-panel';
import { MatchPanel } from '@/modules/banking/components/match-panel';
import type { ActiveMatchInfo } from '@/modules/banking/components/match-panel';
import { BulkAutoMatchButton } from '@/modules/banking/components/bulk-auto-match-button';
import { RegisterAddTransaction } from '@/modules/banking/components/register-add-transaction';

type ActiveMatchType = ActiveMatchInfo['matchType'];
import { BANK_ACCOUNT_TYPE_LABEL } from '@/modules/banking/schema';
import {
  firstMatchingRule,
  toRuleForMatching,
  toTxnForMatching,
  triageState,
} from '@/modules/banking/lib/rules';
import {
  findCandidates,
  toAmount,
  type InvoicePaymentCandidate,
  type JobCostEntryCandidate,
  type ReceiptCandidate,
} from '@/modules/banking/lib/match-candidates';

export const dynamic = 'force-dynamic';

function parseStr(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v[0]?.trim() ?? '';
  return '';
}

export default async function BankAccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'bank_accounts')) redirect('/dashboard' as never);
  const company = await getActiveCompany();
  const { id } = await params;
  const sp = await searchParams;
  const account = await getBankAccount(company.id, id);
  if (!account) notFound();

  const search = parseStr(sp.q);
  const fromDate = parseStr(sp.from);
  const toDate = parseStr(sp.to);
  const includeIgnored = parseStr(sp.ignored) === '1';
  // Reviewed transactions drop off the worklist by default (their data is
  // already saved); tick "Show reviewed" to bring them back for audit.
  const showReviewed = parseStr(sp.reviewed) === '1';
  // Show ONLY reviewed transactions (audit view) — distinct from "show
  // reviewed" which adds them to the unreviewed worklist.
  const reviewedOnly = parseStr(sp.reviewedOnly) === '1';
  const onlyUncategorized = parseStr(sp.uncategorized) === '1';

  const [
    transactions,
    total,
    reviewedCount,
    accounts,
    projects,
    costCodes,
    rules,
    payments,
    invoices,
    receipts,
    vendors,
    customers,
    jobCostEntries,
    activeMatches,
    bankAccountList,
    transferCandidatesRaw,
  ] = await Promise.all([
    listImportedTransactions(company.id, {
      bankAccountId: account.id,
      search: search || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      includeIgnored,
      onlyUnreviewed: !showReviewed && !reviewedOnly,
      onlyReviewed: reviewedOnly,
      onlyUncategorized,
      limit: 200,
    }),
    countImportedTransactions(company.id, {
      bankAccountId: account.id,
      includeIgnored: true,
    }),
    countImportedTransactions(company.id, {
      bankAccountId: account.id,
      onlyReviewed: true,
    }),
    listAccountingAccounts(company.id),
    listProjects(company.id),
    listCostCodes(company.id),
    listBankingRules(company.id), // enabled-only — disabled rules don't suggest
    // Reconciliation candidates ─ load company-wide (capped) so the matcher
    // doesn't miss e.g. an AR payment booked against a project in another
    // bank account.
    listPayments(company.id),
    listInvoices(company.id),
    listReceipts(company.id, { status: 'posted', limit: 1000 }),
    listVendors(company.id),
    listCustomers(company.id),
    listAllJobCostEntriesForCompany(company.id, { limit: 2000 }),
    listActiveMatchesForCompany(company.id),
    listBankAccounts(company.id),
    // Cross-account transfer candidates: unreconciled bank transactions in
    // OTHER accounts that could plausibly pair with anything here.
    (async () => {
      const all = await listImportedTransactions(company.id, {
        includeIgnored: false,
        limit: 1000,
      });
      return all.filter(
        (t) => t.bankAccountId !== account.id && t.reconciledAt === null,
      );
    })(),
  ]);

  // Statement reconciliation status — the QB-style "R". A transaction cleared
  // inside a COMPLETED bank reconciliation is proven against the statement.
  const bankRecs = await listBankReconciliations(company.id, {
    bankAccountId: account.id,
  });
  const completedRecDateById = new Map(
    bankRecs
      .filter((r) => r.status === 'completed')
      .map((r) => [r.id, r.statementDate]),
  );

  // Register running balance (opening + full-ledger cumulative sum) — correct
  // per row regardless of the filters applied to the visible list.
  const runningBalanceById = await getRunningBalancesForAccount(
    company.id,
    account.id,
    Number(account.openingBalance),
  );

  // Split lines for the visible transactions (one extra query, batched).
  const allLines = await listLinesForTransactionIds(
    company.id,
    transactions.map((t) => t.id),
  );
  const linesByTxn = new Map<string, typeof allLines>();
  for (const ln of allLines) {
    const arr = linesByTxn.get(ln.importedTransactionId) ?? [];
    arr.push(ln);
    linesByTxn.set(ln.importedTransactionId, arr);
  }

  // The VAT Input (Recoverable) account — target of the "Auto-VAT split"
  // button. Resolved by type so it works regardless of code/name. Null when
  // the company isn't VAT-active (no such account seeded).
  const vatInputAccountId =
    accounts.find((a) => a.type === 'vat_input' && !a.isArchived)?.id ?? null;

  // Rules pre-sorted by priority ASC, then created_at ASC (data layer does this).
  const matcherRules = rules.map(toRuleForMatching);
  const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));

  // Build lookup maps used by the match panel labels.
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const projectByIdMap = new Map(projects.map((p) => [p.id, p]));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const accountByIdMap = new Map(bankAccountList.map((b) => [b.id, b]));
  // Accounting-account (category) names, so a categorized/split row can show
  // WHAT it was categorized as — not just an "auto-filled" badge over blank
  // columns. A VAT-split puts categories on the lines (header is null), so the
  // row would otherwise look empty even though it's fully categorized.
  const categoryNameById = new Map(accounts.map((a) => [a.id, a.name]));

  // Indices of records already claimed by an active match — passed to the
  // matcher to filter them out of candidate lists.
  const takenInvoicePaymentIds = new Set(
    activeMatches
      .filter((m) => m.invoicePaymentId !== null)
      .map((m) => m.invoicePaymentId!),
  );
  const takenReceiptIds = new Set(
    activeMatches.filter((m) => m.receiptId !== null).map((m) => m.receiptId!),
  );
  const takenJobCostEntryIds = new Set(
    activeMatches
      .filter((m) => m.jobCostEntryId !== null)
      .map((m) => m.jobCostEntryId!),
  );

  // Pre-shape candidates once. Payments tied to voided invoices are filtered
  // out — a void invoice can never have cash that actually hit the bank, so
  // such a payment can never be a legitimate reconciliation match for a real
  // bank transaction.
  const invoicePaymentCandidates: InvoicePaymentCandidate[] = payments
    .filter((p) => invoiceById.get(p.invoiceId)?.status !== 'void')
    .map((p) => {
      const inv = invoiceById.get(p.invoiceId);
      const proj = inv?.projectId ? projectByIdMap.get(inv.projectId) : null;
      const cust = proj ? customerById.get(proj.customerId) : null;
      return {
        id: p.id,
        invoiceId: p.invoiceId,
        paidDate: p.paidDate,
        amount: Number(p.amount),
        invoiceNumber: inv?.number ?? '—',
        customerName: cust?.name ?? '—',
      };
    });
  // Vendor credits reduce what a bill's bank payment should be — candidates
  // match on the NET due (total − applied credits), which is exactly how a
  // payment of (bill − credit) reconciles.
  const appliedCreditByReceipt = await sumAppliedCreditsByReceipt(
    company.id,
    receipts.map((r) => r.id),
  );
  const receiptCandidates: ReceiptCandidate[] = receipts.map((r) => {
    const v = r.vendorId ? vendorById.get(r.vendorId) : null;
    const netDue =
      Math.round(
        (Number(r.total) - (appliedCreditByReceipt.get(r.id) ?? 0)) * 100,
      ) / 100;
    return {
      id: r.id,
      receiptDate: r.receiptDate,
      amount: netDue,
      vendorName: v?.name ?? 'Receipt',
      description: r.notes ?? '',
    };
  });
  const jobCostEntryCandidates: JobCostEntryCandidate[] = jobCostEntries
    // Skip entries already sourced from a receipt — those go through
    // receiptCandidates already and would otherwise double-suggest.
    .filter((j) => j.source !== 'receipt_import' && j.source !== 'po_receipt')
    .map((j) => {
      const v = j.vendorId ? vendorById.get(j.vendorId) : null;
      const p = projectByIdMap.get(j.projectId);
      return {
        id: j.id,
        entryDate: j.entryDate,
        amount: Number(j.amount),
        description: j.description,
        projectName: p?.name ?? null,
        vendorName: v?.name ?? null,
      };
    });

  // Active matches keyed by bank-txn id for fast per-row lookup. A deposit may
  // carry SEVERAL invoice_payment matches (a lump customer payment), so those
  // are grouped into a list; every other match type stays one-per-txn.
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const invoiceMatchesByTxn = new Map<
    string,
    Array<{
      matchId: string;
      invoiceNumber: string;
      customerName: string;
      amount: number;
    }>
  >();
  const nonInvoiceMatchByTxn = new Map<
    string,
    (typeof activeMatches)[number]
  >();
  for (const m of activeMatches) {
    if (m.matchType === 'invoice_payment' && m.invoicePaymentId) {
      const p = paymentById.get(m.invoicePaymentId);
      if (!p) continue;
      const inv = invoiceById.get(p.invoiceId);
      const proj = inv?.projectId ? projectByIdMap.get(inv.projectId) : null;
      const cust = proj ? customerById.get(proj.customerId) : null;
      const arr = invoiceMatchesByTxn.get(m.importedTransactionId) ?? [];
      arr.push({
        matchId: m.id,
        invoiceNumber: inv?.number ?? '—',
        customerName: cust?.name ?? '—',
        amount: Number(p.amount),
      });
      invoiceMatchesByTxn.set(m.importedTransactionId, arr);
    } else {
      nonInvoiceMatchByTxn.set(m.importedTransactionId, m);
    }
  }

  // Receipt attachments per transaction: a txn → its matched receipt(s) →
  // their attachment counts. Surfaced as a paperclip badge on the row so the
  // operator sees "this line has a receipt" at a glance, no expand needed.
  // (A batch bill payment can match several receipts to one txn — sum them.)
  const receiptIdsByTxn = new Map<string, string[]>();
  for (const m of activeMatches) {
    if (m.matchType === 'receipt' && m.receiptId) {
      const arr = receiptIdsByTxn.get(m.importedTransactionId) ?? [];
      arr.push(m.receiptId);
      receiptIdsByTxn.set(m.importedTransactionId, arr);
    }
  }
  const allMatchedReceiptIds = Array.from(
    new Set(Array.from(receiptIdsByTxn.values()).flat()),
  );
  const attachmentCountByReceipt = await countAttachmentsByReceiptIds(
    company.id,
    allMatchedReceiptIds,
  );
  const attachmentInfoByTxn = new Map<
    string,
    { count: number; primaryReceiptId: string }
  >();
  for (const [txnId, rIds] of receiptIdsByTxn) {
    const count = rIds.reduce(
      (s, rid) => s + (attachmentCountByReceipt.get(rid) ?? 0),
      0,
    );
    attachmentInfoByTxn.set(txnId, { count, primaryReceiptId: rIds[0] });
  }

  // Pre-shape transfer candidates (cross-account, unreconciled).
  const transferCandidates = transferCandidatesRaw.map((t) => ({
    id: t.id,
    accountName:
      accountByIdMap.get(t.bankAccountId)?.name ?? 'Other account',
    transactionDate: t.transactionDate,
    description: t.description,
    amount: Number(t.amount),
    currency: t.currency,
  }));

  // Count exact pairs so the bulk-match button can label itself.
  let exactPairCount = 0;
  for (const t of transactions) {
    if (t.reconciledAt) continue;
    if (t.isIgnored) continue;
    const amt = Number(t.amount);
    const absCents = Math.round(Math.abs(amt) * 100);
    if (amt > 0) {
      const has = payments.some(
        (p) =>
          !takenInvoicePaymentIds.has(p.id) &&
          invoiceById.get(p.invoiceId)?.status !== 'void' &&
          p.paidDate === t.transactionDate &&
          Math.round(Math.abs(Number(p.amount)) * 100) === absCents,
      );
      if (has) exactPairCount += 1;
    } else if (amt < 0) {
      const has = receipts.some(
        (r) =>
          !takenReceiptIds.has(r.id) &&
          r.receiptDate === t.transactionDate &&
          Math.round(
            Math.abs(
              Number(r.total) - (appliedCreditByReceipt.get(r.id) ?? 0),
            ) * 100,
          ) === absCents,
      );
      if (has) exactPairCount += 1;
    }
  }

  const categories = toAccountingAccountOptions(
    accounts.filter((a) => a.type !== 'bank' && a.type !== 'credit_card'),
  );

  // Expense accounts offered as the bank-fee line on a batch bill payment.
  const feeAccountOptions = categories
    .filter(
      (c) =>
        !c.isHeader && (c.rollupGroup === 'opex' || c.rollupGroup === 'cogs'),
    )
    .map((c) => ({ id: c.id, name: c.name }));

  const projectOptions = projects.map((p) => ({
    id: p.id,
    label: p.name,
  }));
  const costCodeOptions = costCodes.map((c) => ({
    id: c.id,
    label: `${c.code} — ${c.description}`,
  }));
  // Vendor options for the per-row payee picker. Carry each vendor's default
  // accounting category so picking a vendor can prefill the category.
  const vendorOptions = vendors.map((v) => ({
    id: v.id,
    label: v.name,
    defaultAccountingAccountId: v.defaultAccountingAccountId ?? null,
    vatRatePercent: v.vatRatePercent ? Number(v.vatRatePercent) : null,
  }));
  const customerOptions = customers.map((c) => ({ id: c.id, name: c.name }));

  const canEdit = canCreate(role, 'statement_imports');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={{ pathname: '/banking' }}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← Back to Banking
          </Link>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">
            {account.name}
          </h1>
          <p className="text-sm text-slate-500">
            {BANK_ACCOUNT_TYPE_LABEL[account.type]} ·{' '}
            {account.last4 ? `****${account.last4} · ` : ''}
            {account.currency} · Opening{' '}
            {formatMoney(account.openingBalance, account.currency)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate(role, 'bank_accounts') && (
            <Link href={{ pathname: `/banking/accounts/${account.id}/edit` }}>
              <Button variant="outline">Edit account</Button>
            </Link>
          )}
          {canEdit && (
            <Link href={{ pathname: `/banking/accounts/${account.id}/categorize` }}>
              <Button variant="outline">Categorize to jobs</Button>
            </Link>
          )}
          <Link href={{ pathname: '/banking/rules' }}>
            <Button variant="outline">Rules</Button>
          </Link>
          {canEdit && (
            <Link href={{ pathname: '/accounting/journal' }}>
              <Button variant="outline">Journal entry</Button>
            </Link>
          )}
          <Link href={{ pathname: '/banking/reconcile' }}>
            <Button variant="outline">Reconcile</Button>
          </Link>
          {canEdit && (
            <BulkAutoMatchButton
              bankAccountId={account.id}
              exactCount={exactPairCount}
            />
          )}
          {canEdit && (
            <Link href={{ pathname: '/banking/import' }}>
              <Button>Import statement</Button>
            </Link>
          )}
        </div>
      </div>

      {canEdit && (
        <RegisterAddTransaction
          bankAccountId={account.id}
          isCreditCard={account.type === 'credit_card'}
          accountOptions={categories}
          vendorOptions={vendorOptions.map((v) => ({ id: v.id, label: v.label }))}
          projectOptions={projectOptions}
          otherAccounts={bankAccountList
            .filter((b) => b.id !== account.id && !b.archivedAt)
            .map((b) => ({ id: b.id, label: b.name }))}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <Label htmlFor="q">Search</Label>
              <Input id="q" name="q" defaultValue={search} placeholder="Description, payee" />
            </div>
            <div>
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={fromDate} />
            </div>
            <div>
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={toDate} />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  name="reviewed"
                  value="1"
                  defaultChecked={showReviewed}
                  className="h-4 w-4"
                />
                Show reviewed{reviewedCount > 0 ? ` (${reviewedCount})` : ''}
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  name="reviewedOnly"
                  value="1"
                  defaultChecked={reviewedOnly}
                  className="h-4 w-4"
                />
                Reviewed only
              </label>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  name="uncategorized"
                  value="1"
                  defaultChecked={onlyUncategorized}
                  className="h-4 w-4"
                />
                Uncategorized only
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  name="ignored"
                  value="1"
                  defaultChecked={includeIgnored}
                  className="h-4 w-4"
                />
                Show ignored
              </label>
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="outline" className="w-full">
                Apply
              </Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Showing {transactions.length} of {total} transaction(s) for this
            account.
            {!showReviewed && reviewedCount > 0 && (
              <> {reviewedCount} reviewed {reviewedCount === 1 ? 'is' : 'are'} hidden — tick &quot;Show reviewed&quot; to see them.</>
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {transactions.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No transactions match. Try widening the date range or running an
              import.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="text-center">Attach</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => {
                  // Per-row rule + match lookup. All inputs are pre-loaded
                  // above so this stays O(n) without extra DB queries.
                  const txnLines = linesByTxn.get(t.id) ?? [];
                  const hasLines = txnLines.length > 0;
                  const txnLike = toTxnForMatching({
                    bankAccountId: t.bankAccountId,
                    description: t.description,
                    payee: t.payee,
                    memo: t.memo,
                    reference: t.reference,
                    amount: t.amount,
                    isReviewed: t.isReviewed,
                    isIgnored: t.isIgnored,
                    // A split transaction has no single category, but it IS
                    // categorized — surface a non-null value so the triage
                    // badge reads "categorized", not "uncategorized".
                    accountingAccountId: hasLines
                      ? (t.accountingAccountId ?? 'split')
                      : t.accountingAccountId,
                    appliedRuleId: t.appliedRuleId,
                    reconciledAt: t.reconciledAt,
                  });
                  const matched = firstMatchingRule(txnLike, matcherRules);
                  const triage = triageState(txnLike, matched);
                  // What this row was actually categorized as — shown in the
                  // row so an "auto-filled"/categorized line isn't visually
                  // blank. Split lines carry the categories (header is null).
                  const rowLines = linesByTxn.get(t.id) ?? [];
                  const categorySummary =
                    rowLines.length > 0
                      ? rowLines
                          .map((l) =>
                            l.accountingAccountId
                              ? (categoryNameById.get(l.accountingAccountId) ??
                                'Unknown')
                              : 'Uncategorized',
                          )
                          .join(' + ')
                      : t.accountingAccountId
                        ? (categoryNameById.get(t.accountingAccountId) ?? null)
                        : null;
                  const vendorLabel = t.vendorId
                    ? (vendorById.get(t.vendorId)?.name ?? null)
                    : null;
                  const showRulePanel =
                    triage === 'suggested' ||
                    triage === 'auto_filled' ||
                    triage === 'manually_categorized' ||
                    triage === 'reviewed';
                  const showMatchPanel =
                    !t.isIgnored &&
                    (triage === 'reconciled' || canEdit);
                  // Find suggestions only for unreconciled rows.
                  const candidates =
                    triage === 'reconciled'
                      ? {
                          invoicePayments: [],
                          receipts: [],
                          jobCostEntries: [],
                        }
                      : findCandidates({
                          txn: {
                            id: t.id,
                            transactionDate: t.transactionDate,
                            amount: toAmount(t.amount),
                          },
                          invoicePayments: invoicePaymentCandidates,
                          receipts: receiptCandidates,
                          jobCostEntries: jobCostEntryCandidates,
                          takenInvoicePaymentIds,
                          takenReceiptIds,
                          takenJobCostEntryIds,
                        });
                  const activeMatch = nonInvoiceMatchByTxn.get(t.id);
                  const reconciledStmtDate = t.bankReconciliationId
                    ? (completedRecDateById.get(t.bankReconciliationId) ?? null)
                    : null;
                  const txnInvoiceMatches =
                    invoiceMatchesByTxn.get(t.id) ?? [];
                  let activeLabel = '';
                  if (activeMatch) {
                    if (
                      activeMatch.matchType === 'invoice_payment' &&
                      activeMatch.invoicePaymentId
                    ) {
                      const p = payments.find(
                        (x) => x.id === activeMatch.invoicePaymentId,
                      );
                      const inv = p ? invoiceById.get(p.invoiceId) : null;
                      activeLabel = inv
                        ? `Invoice payment ${inv.number}`
                        : 'Invoice payment';
                    } else if (
                      activeMatch.matchType === 'receipt' &&
                      activeMatch.receiptId
                    ) {
                      const r = receipts.find(
                        (x) => x.id === activeMatch.receiptId,
                      );
                      const v = r?.vendorId ? vendorById.get(r.vendorId) : null;
                      activeLabel = r
                        ? `Receipt ${r.receiptDate}${v ? ` — ${v.name}` : ''}`
                        : 'Receipt';
                    } else if (
                      activeMatch.matchType === 'job_cost_entry' &&
                      activeMatch.jobCostEntryId
                    ) {
                      const j = jobCostEntries.find(
                        (x) => x.id === activeMatch.jobCostEntryId,
                      );
                      activeLabel = j
                        ? `Job cost: ${j.description.slice(0, 60)}`
                        : 'Job cost entry';
                    } else if (
                      activeMatch.matchType === 'transfer' &&
                      activeMatch.transferPairedTxnId
                    ) {
                      const pairedAccount = transferCandidatesRaw.find(
                        (x) => x.id === activeMatch.transferPairedTxnId,
                      );
                      activeLabel = pairedAccount
                        ? `Transfer ↔ ${
                            accountByIdMap.get(pairedAccount.bankAccountId)
                              ?.name ?? 'other account'
                          }`
                        : 'Transfer';
                    } else if (activeMatch.matchType === 'owner_contribution') {
                      activeLabel = 'Owner contribution';
                    } else if (activeMatch.matchType === 'owner_draw') {
                      activeLabel = 'Owner draw';
                    }
                  }
                  return (
                    <Fragment key={t.id}>
                      <TableRow
                        className={t.isIgnored ? 'opacity-50' : undefined}
                      >
                        <TableCell className="text-xs font-mono">
                          {t.transactionDate}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{t.description}</div>
                          {t.memo && (
                            <div className="text-xs text-slate-500">
                              {t.memo}
                            </div>
                          )}
                          {categorySummary && (
                            <div className="mt-0.5 text-xs text-slate-600">
                              <span className="text-slate-400">Category: </span>
                              {rowLines.length > 1 ? `Split — ${categorySummary}` : categorySummary}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {vendorLabel ?? t.payee ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">
                          {t.debit !== null
                            ? formatMoney(t.debit, t.currency)
                            : '—'}
                          {t.debit !== null && reconciledStmtDate && (
                            <ReconciledR statementDate={reconciledStmtDate} />
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {t.credit !== null
                            ? formatMoney(t.credit, t.currency)
                            : '—'}
                          {t.credit !== null && reconciledStmtDate && (
                            <ReconciledR statementDate={reconciledStmtDate} />
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            (runningBalanceById.get(t.id) ?? 0) < 0
                              ? 'text-red-600'
                              : 'text-slate-700'
                          }`}
                        >
                          {runningBalanceById.has(t.id)
                            ? formatMoney(runningBalanceById.get(t.id)!, t.currency)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-500">
                          {t.reference ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {triage === 'reconciled' && (
                            <span className="inline-block rounded bg-emerald-100 text-emerald-900 px-1.5 py-0.5 mr-1 font-medium">
                              reconciled
                            </span>
                          )}
                          {triage === 'reviewed' && (
                            <span className="inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 mr-1">
                              reviewed
                            </span>
                          )}
                          {triage === 'auto_filled' && (
                            <span className="inline-block rounded bg-purple-100 text-purple-800 px-1.5 py-0.5 mr-1">
                              auto-filled
                            </span>
                          )}
                          {triage === 'suggested' && (
                            <span className="inline-block rounded bg-blue-100 text-blue-800 px-1.5 py-0.5 mr-1">
                              suggested
                            </span>
                          )}
                          {triage === 'manually_categorized' && (
                            <span className="inline-block rounded bg-slate-200 text-slate-700 px-1.5 py-0.5 mr-1">
                              categorized
                            </span>
                          )}
                          {triage === 'ignored' && (
                            <span className="inline-block rounded bg-slate-200 text-slate-700 px-1.5 py-0.5 mr-1">
                              ignored
                            </span>
                          )}
                          {triage === 'uncategorized' && (
                            <span className="inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">
                              uncategorized
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {(() => {
                            const attach = attachmentInfoByTxn.get(t.id);
                            if (!attach || attach.count === 0) {
                              return <span className="text-slate-300">—</span>;
                            }
                            return (
                              <a
                                href={`/banking/receipts/${attach.primaryReceiptId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`${attach.count} attachment${attach.count === 1 ? '' : 's'} — open receipt`}
                                className="inline-flex flex-col items-center text-slate-600 hover:text-slate-900"
                              >
                                <span aria-hidden className="text-base leading-none">
                                  📎
                                </span>
                                <span className="text-[11px] font-medium tabular-nums">
                                  {attach.count}
                                </span>
                              </a>
                            );
                          })()}
                        </TableCell>
                      </TableRow>
                      {showMatchPanel && (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="bg-white px-3 pt-2 pb-0"
                          >
                            <MatchPanel
                              transactionId={t.id}
                              bankAccountId={t.bankAccountId}
                              amount={Number(t.amount)}
                              candidates={candidates}
                              transferCandidates={transferCandidates}
                              active={
                                activeMatch
                                  ? {
                                      matchId: activeMatch.id,
                                      matchType:
                                        activeMatch.matchType as ActiveMatchType,
                                      targetLabel: activeLabel || 'Reconciled',
                                      receiptId:
                                        activeMatch.matchType === 'receipt'
                                          ? activeMatch.receiptId
                                          : null,
                                    }
                                  : null
                              }
                              invoiceMatches={txnInvoiceMatches}
                              reconciled={triage === 'reconciled'}
                              feeAccountOptions={feeAccountOptions}
                              canEdit={canEdit}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      {showRulePanel && (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="bg-white px-3 pt-2 pb-0"
                          >
                            <TransactionRulePanel
                              transactionId={t.id}
                              triage={triage}
                              match={
                                matched && matched.matched
                                  ? {
                                      ruleId: matched.rule.id,
                                      ruleName: matched.rule.name,
                                      reasons: matched.reasons,
                                    }
                                  : null
                              }
                              appliedRule={
                                t.appliedRuleId
                                  ? {
                                      id: t.appliedRuleId,
                                      name:
                                        ruleNameById.get(t.appliedRuleId) ??
                                        '(deleted rule)',
                                    }
                                  : null
                              }
                              canApply={canEdit}
                              canReview={canEdit}
                              canCreateRule={canEdit}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow>
                        <TableCell colSpan={9} className="bg-slate-50 p-3">
                          <TransactionRowForm
                            id={t.id}
                            initial={{
                              accountingAccountId: t.accountingAccountId,
                              projectId: t.projectId,
                              costCodeId: t.costCodeId,
                              vendorId: t.vendorId,
                              isReviewed: t.isReviewed,
                              isIgnored: t.isIgnored,
                              notes: t.notes,
                              lines: (linesByTxn.get(t.id) ?? []).map((ln) => ({
                                accountingAccountId: ln.accountingAccountId,
                                projectId: ln.projectId,
                                costCodeId: ln.costCodeId,
                                description: ln.description,
                                amount: Number(ln.amount),
                              })),
                            }}
                            grossAmount={Math.abs(Number(t.amount))}
                            currency={t.currency}
                            categories={categories}
                            projects={projectOptions}
                            costCodes={costCodeOptions}
                            vendors={vendorOptions}
                            customers={customerOptions}
                            vatInputAccountId={vatInputAccountId}
                            companyVatRatePercent={
                              company.vatRatePercent
                                ? Number(company.vatRatePercent)
                                : null
                            }
                            canEdit={canEdit}
                          />
                        </TableCell>
                      </TableRow>
                      {/* Separator between transactions — the per-row form
                          blends into the next row otherwise (operator
                          feedback). A thick band clearly delimits each txn. */}
                      <TableRow aria-hidden className="hover:bg-transparent">
                        <TableCell
                          colSpan={9}
                          className="h-3 p-0 bg-slate-200/70 border-y border-slate-300"
                        />
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** QB-style "R": this transaction cleared inside a COMPLETED bank
 *  reconciliation, i.e. it is proven against the bank statement. */
function ReconciledR({ statementDate }: { statementDate: string }) {
  return (
    <span
      title={`Reconciled — cleared on the ${statementDate} bank statement`}
      className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-sm bg-emerald-100 align-middle text-[10px] font-bold text-emerald-700"
    >
      R
    </span>
  );
}
