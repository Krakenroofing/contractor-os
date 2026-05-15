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
} from '@/lib/data/statement-imports';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listBankingRules } from '@/lib/data/banking-rules';
import { TransactionRowForm } from '@/modules/banking/components/transaction-row-form';
import { TransactionRulePanel } from '@/modules/banking/components/transaction-rule-panel';
import { BANK_ACCOUNT_TYPE_LABEL } from '@/modules/banking/schema';
import {
  firstMatchingRule,
  toRuleForMatching,
  toTxnForMatching,
  triageState,
} from '@/modules/banking/lib/rules';

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
  const onlyUnreviewed = parseStr(sp.unreviewed) === '1';
  const onlyUncategorized = parseStr(sp.uncategorized) === '1';

  const [transactions, total, accounts, projects, costCodes, rules] =
    await Promise.all([
      listImportedTransactions(company.id, {
        bankAccountId: account.id,
        search: search || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        includeIgnored,
        onlyUnreviewed,
        onlyUncategorized,
        limit: 200,
      }),
      countImportedTransactions(company.id, {
        bankAccountId: account.id,
        includeIgnored: true,
      }),
      listAccountingAccounts(company.id),
      listProjects(company.id),
      listCostCodes(company.id),
      listBankingRules(company.id), // enabled-only — disabled rules don't suggest
    ]);

  // Rules pre-sorted by priority ASC, then created_at ASC (data layer does this).
  const matcherRules = rules.map(toRuleForMatching);
  const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));

  const categories = accounts
    .filter((a) => !a.isArchived)
    .filter(
      (a) =>
        a.type === 'expense' ||
        a.type === 'income' ||
        a.type === 'cogs_job_cost' ||
        a.type === 'vat_payable' ||
        a.type === 'vat_input' ||
        a.type === 'owner_equity' ||
        a.type === 'uncategorized_income' ||
        a.type === 'uncategorized_expense',
    )
    .map((a) => ({
      id: a.id,
      label: a.code ? `${a.code} — ${a.name}` : a.name,
    }));

  const projectOptions = projects.map((p) => ({
    id: p.id,
    label: `${p.number} — ${p.name}`,
  }));
  const costCodeOptions = costCodes.map((c) => ({
    id: c.id,
    label: `${c.code} — ${c.description}`,
  }));

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
        {canEdit && (
          <Link href={{ pathname: '/banking/import' }}>
            <Button>Import statement</Button>
          </Link>
        )}
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
                  name="unreviewed"
                  value="1"
                  defaultChecked={onlyUnreviewed}
                  className="h-4 w-4"
                />
                Unreviewed only
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
                  // Per-row rule lookup. Runs in TS over the pre-loaded rules
                  // — no extra DB query per transaction.
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
                  const matched = firstMatchingRule(txnLike, matcherRules);
                  const triage = triageState(txnLike, matched);
                  const showRulePanel =
                    triage === 'suggested' ||
                    triage === 'auto_filled' ||
                    triage === 'manually_categorized' ||
                    triage === 'reviewed';
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
                              isReviewed: t.isReviewed,
                              isIgnored: t.isIgnored,
                              notes: t.notes,
                            }}
                            categories={categories}
                            projects={projectOptions}
                            costCodes={costCodeOptions}
                            canEdit={canEdit}
                          />
                        </TableCell>
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
