import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { can, canCreate } from '@/lib/permissions';
import { getBankingRule } from '@/lib/data/banking-rules';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { RuleForm } from '@/modules/banking/components/rule-form';
import { toAccountingAccountOptions } from '@/modules/accounting/components/accounting-account-picker';
import { RulePreviewPanel } from '@/modules/banking/components/rule-preview-panel';
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
          <CardTitle>Preview &amp; bulk apply</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-500 mb-3">
            Runs this saved rule against the most recent 500 transactions in
            this company. Bulk apply only writes to transactions that are not
            yet reviewed and not yet categorized.
          </p>
          <RulePreviewPanel
            ruleId={rule.id}
            canApply={can(role, 'statement_imports', 'create')}
          />
        </CardContent>
      </Card>

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
            categories={toAccountingAccountOptions(
              accountingAccounts.filter(
                (a) => a.type !== 'bank' && a.type !== 'credit_card',
              ),
            )}
            projects={projects.map((p) => ({
              id: p.id,
              label: p.name,
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
