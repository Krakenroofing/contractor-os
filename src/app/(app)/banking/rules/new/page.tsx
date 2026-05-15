import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { getImportedTransaction } from '@/lib/data/statement-imports';
import { RuleForm } from '@/modules/banking/components/rule-form';
import type {
  AppliesTo,
  Matcher,
  RuleActionPayload,
} from '@/modules/banking/lib/rules';

export const dynamic = 'force-dynamic';

// "Create rule from this transaction" suggests a sensible default match value
// by trimming numeric tails, store IDs, and ZIP suffixes from a description.
// We keep it conservative — the user will refine in the form.
function suggestMatchValue(raw: string): string {
  const cleaned = raw
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b\d{1,5}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Cap to first ~3 words to avoid over-fitting to one specific transaction.
  const words = cleaned.split(' ').filter(Boolean).slice(0, 3);
  return words.join(' ').toUpperCase();
}

export default async function NewBankingRulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'banking_rules')) {
    redirect('/banking/rules' as never);
  }
  const company = await getActiveCompany();
  const sp = await searchParams;
  const fromTxnId = typeof sp.fromTxn === 'string' ? sp.fromTxn : null;

  const [accounts, accountingAccounts, projects, costCodes] = await Promise.all([
    listBankAccounts(company.id),
    listAccountingAccounts(company.id),
    listProjects(company.id),
    listCostCodes(company.id),
  ]);

  let initial:
    | {
        name: string;
        enabled: boolean;
        priority: number;
        appliesTo: AppliesTo;
        bankAccountId: string | null;
        amountMin: number | null;
        amountMax: number | null;
        matchers: Matcher[];
        actions: RuleActionPayload;
      }
    | undefined;

  if (fromTxnId) {
    const txn = await getImportedTransaction(company.id, fromTxnId);
    if (txn) {
      const amountNum = Number(txn.amount);
      const appliesTo: AppliesTo =
        amountNum < 0 ? 'debits' : amountNum > 0 ? 'credits' : 'all';
      const suggestion = suggestMatchValue(txn.description);
      initial = {
        name: suggestion ? `${suggestion} → categorize` : 'New rule',
        enabled: true,
        priority: 100,
        appliesTo,
        bankAccountId: txn.bankAccountId,
        amountMin: null,
        amountMax: null,
        matchers: [
          {
            field: 'description',
            op: 'contains',
            value: suggestion || txn.description.slice(0, 40),
            case_sensitive: false,
          },
        ],
        actions: {
          accountingAccountId: txn.accountingAccountId,
          projectId: txn.projectId,
          costCodeId: txn.costCodeId,
          notes: null,
        },
      };
    }
  }

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
          {fromTxnId ? 'Create rule from transaction' : 'New rule'}
        </h1>
        {fromTxnId && (
          <p className="text-sm text-slate-500">
            We prefilled a starting match from the transaction. Refine it so it
            applies broadly to similar future transactions.
          </p>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Rule details</CardTitle>
        </CardHeader>
        <CardContent>
          <RuleForm
            initial={initial}
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
