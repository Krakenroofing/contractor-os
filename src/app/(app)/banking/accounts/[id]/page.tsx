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
  listImportedTransactions,
  listLinesForTransactionIds,
} from '@/lib/data/statement-imports';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listBankingRules } from '@/lib/data/banking-rules';
import { listPayments } from '@/lib/data/invoice-payments';
import { listInvoices } from '@/lib/data/invoices';
import { listReceipts } from '@/lib/data/receipts';
import { listVendors } from '@/lib/data/vendors';
import { listCustomers } from '@/lib/data/customers';
import { listAllJobCostEntriesForCompany } from '@/lib/data/job-cost-entries';
import { listActiveMatchesForCompany } from '@/lib/data/transaction-matches';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { TransactionRowForm } from '@/modules/banking/components/transaction-row-form';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import { TransactionRulePanel } from '@/modules/banking/components/transaction-rule-panel';
import { MatchPanel } from '@/modules/banking/components/match-panel';
import type { ActiveMatchInfo } from '@/modules/banking/components/match-panel';
import { BulkAutoMatchButton } from '@/modules/banking/components/bulk-auto-match-button';

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
      onlyUnreviewed: !showReviewed,
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
  const receiptCandidates: ReceiptCandidate[] = receipts.map((r) => {
    const v = r.vendorId ? vendorById.get(r.vendorId) : null;
    return {
      id: r.id,
      receiptDate: r.receiptDate,
      amount: Number(r.total),
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

  // Active matches keyed by bank-txn id for fast per-row lookup.
  const matchByTxnId = new Map(
    activeMatches.map((m) => [m.importedTransactionId, m]),
  );

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
          Math.round(Math.abs(Number(r.total)) * 100) === absCents,
      );
      if (has) exactPairCount += 1;
    }
  }

  const categories = toAccountingAccountOptions(
    accounts.filter((a) => a.type !== 'bank' && a.type !== 'credit_card'),
  );

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
          {canEdit && (
            <Link href={{ pathname: `/banking/accounts/${account.id}/categorize` }}>
              <Button variant="outline">Categorize to jobs</Button>
            </Link>
          )}
          <Link href={{ pathname: '/banking/rules' }}>
            <Button variant="outline">Rules</Button>
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
                  <TableHead>Reference</TableHead>
                  <TableHead>Flags</TableHead>
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
                  const activeMatch = matchByTxnId.get(t.id);
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
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {t.payee ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">
                          {t.debit !== null
                            ? formatMoney(t.debit, t.currency)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {t.credit !== null
                            ? formatMoney(t.credit, t.currency)
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
                      </TableRow>
                      {showMatchPanel && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
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
                                    }
                                  : null
                              }
                              canEdit={canEdit}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      {showRulePanel && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
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
                        <TableCell colSpan={7} className="bg-slate-50 p-3">
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
                          colSpan={7}
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
