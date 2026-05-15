import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getBankingRule } from '@/lib/data/banking-rules';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { RuleForm } from '@/modules/banking/components/rule-form';
import { toRuleForMatching } from '@/modules/banking/lib/rules';

export const dynamic = 'force-dynamic';

export default async function EditBankingRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'banking_rules')) {
    redirect('/banking/rules' as never);
  }
  const company = await getActiveCompany();
  const { id } = await params;
  const rule = await getBankingRule(company.id, id);
  if (!rule) notFound();

  const [accounts, accountingAccounts, projects, costCodes] = await Promise.all(
    [
      listBankAccounts(company.id),
      listAccountingAccounts(company.id),
      listProjects(company.id),
      listCostCodes(company.id),
    ],
  );

  const view = toRuleForMatching(rule);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={{ pathname: '/banking/rules' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Rules
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Edit rule
        </h1>
        <p className="text-sm text-slate-500">
          Hits to date:{' '}
          <span className="font-medium tabular-nums">{rule.matchCount}</span>
          {rule.lastMatchedAt && (
            <>
              {' · last applied '}
              {rule.lastMatchedAt.toISOString().slice(0, 10)}
            </>
          )}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Rule details</CardTitle>
        </CardHeader>
        <CardContent>
          <RuleForm
            initial={{
              id: rule.id,
              name: rule.name,
              enabled: rule.enabled,
              priority: rule.priority,
              appliesTo: view.appliesTo,
              bankAccountId: view.bankAccountId,
              amountMin: view.amountMin,
              amountMax: view.amountMax,
              matchers: view.matchers,
              actions: view.actions,
            }}
            bankAccounts={accounts.map((a) => ({
              id: a.id,
              label: `${a.name} (${a.type === 'credit_card' ? 'CC' : 'Bank'})`,
            }))}
            categories={accountingAccounts
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
              }))}
            projects={projects.map((p) => ({
              id: p.id,
              label: `${p.number} — ${p.name}`,
            }))}
            costCodes={costCodes.map((c) => ({
              id: c.id,
              label: `${c.code} — ${c.description}`,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
