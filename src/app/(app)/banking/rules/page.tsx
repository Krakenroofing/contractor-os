import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { listBankingRules } from '@/lib/data/banking-rules';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import {
  RulesList,
  type RuleRow,
} from '@/modules/banking/components/rules-list';
import {
  toRuleForMatching,
  type Matcher,
  describeReason,
} from '@/modules/banking/lib/rules';

export const dynamic = 'force-dynamic';

function summarizeMatchers(matchers: Matcher[]): string {
  if (matchers.length === 0) return '(no conditions)';
  return matchers
    .slice(0, 3)
    .map((m) =>
      describeReason({
        field: m.field,
        op: m.op,
        value: m.value,
        matchedAgainst: '',
      }),
    )
    .join(' AND ') + (matchers.length > 3 ? ` (+${matchers.length - 3} more)` : '');
}

function summarizeActions(
  actions: Record<string, unknown>,
  categoryById: Map<string, string>,
  projectById: Map<string, string>,
  costCodeById: Map<string, string>,
): string {
  const out: string[] = [];
  const cat = actions.accountingAccountId as string | null;
  const proj = actions.projectId as string | null;
  const cc = actions.costCodeId as string | null;
  if (cat) out.push(`Cat: ${categoryById.get(cat) ?? '—'}`);
  if (proj) out.push(`Proj: ${projectById.get(proj) ?? '—'}`);
  if (cc) out.push(`Code: ${costCodeById.get(cc) ?? '—'}`);
  return out.length === 0 ? '(no actions)' : out.join(' · ');
}

export default async function BankingRulesPage() {
  const role = await getActiveRole();
  if (!canView(role, 'banking_rules')) redirect('/banking' as never);
  const company = await getActiveCompany();
  const [rules, accounts, accountingAccounts, projects, costCodes] =
    await Promise.all([
      listBankingRules(company.id, { includeDisabled: true }),
      listBankAccounts(company.id),
      listAccountingAccounts(company.id),
      listProjects(company.id),
      listCostCodes(company.id),
    ]);

  const accountById = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryById = new Map(
    accountingAccounts.map((a) => [a.id, a.code ? `${a.code} ${a.name}` : a.name]),
  );
  const projectById = new Map(projects.map((p) => [p.id, p.name]));
  const costCodeById = new Map(costCodes.map((c) => [c.id, `${c.code} ${c.description}`]));

  const rows: RuleRow[] = rules.map((r) => {
    const view = toRuleForMatching(r);
    return {
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      priority: r.priority,
      scopeLabel: r.bankAccountId
        ? (accountById.get(r.bankAccountId) ?? 'unknown account')
        : 'All accounts',
      conditionSummary: summarizeMatchers(view.matchers),
      actionSummary: summarizeActions(
        view.actions as Record<string, unknown>,
        categoryById,
        projectById,
        costCodeById,
      ),
      matchCount: r.matchCount,
    };
  });

  const canCreateRule = canCreate(role, 'banking_rules');

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
            Banking Rules
          </h1>
          <p className="text-sm text-slate-500">
            Automatically suggest category, project, and cost code for recurring
            transactions. Phase 1 is suggestion-only — Apply requires a click;
            nothing is posted to job costing.
          </p>
        </div>
        {canCreateRule && (
          <Link href={{ pathname: '/banking/rules/new' }}>
            <Button>New rule</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <RulesList rules={rows} canReorder={canCreateRule} />
        </CardContent>
      </Card>
    </div>
  );
}
