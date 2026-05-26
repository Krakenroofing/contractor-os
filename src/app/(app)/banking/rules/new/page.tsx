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
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import type {
  AppliesTo,
  Matcher,
  RuleActionPayload,
} from '@/modules/banking/lib/rules';

export const dynamic = 'force-dynamic';

// "Create rule from this transaction" suggests a sensible default match value
// by trimming the volatile bits banks tend to append to merchant names. The
// goal is "HOME DEPOT" out of "HOME DEPOT #2143 ATL GA 04/12 POS"; "ABC SUPPLY"
// out of "POS PURCHASE ABC SUPPLY CO 5551234567".
//
// Conservative on purpose — the user always reviews in the form. Better to
// suggest a too-broad stem (e.g. "HOME DEPOT") than a too-narrow one.
const TRANSACTION_NOISE_PREFIXES = [
  'POS PURCHASE',
  'POS DEBIT',
  'POS CREDIT',
  'DEBIT CARD PURCHASE',
  'CHECKCARD',
  'CARD PURCHASE',
  'ACH DEBIT',
  'ACH CREDIT',
  'ONLINE PAYMENT',
  'EFT',
  'WIRE',
  'POS',
];

function suggestMatchValue(raw: string): string {
  let s = raw.trim();
  if (s === '') return '';
  // Strip common leading "channel" noise like "POS PURCHASE ".
  const upper = s.toUpperCase();
  for (const noise of TRANSACTION_NOISE_PREFIXES) {
    if (upper.startsWith(noise + ' ')) {
      s = s.slice(noise.length + 1);
      break;
    }
  }
  const cleaned = s
    // store / location ids like "#2143" or "STORE 1234"
    .replace(/#\s*\d+/g, ' ')
    .replace(/\bSTORE\s+\d+/gi, ' ')
    // long digit runs (phone numbers, account fragments)
    .replace(/\b\d{4,}\b/g, ' ')
    // short digit runs (zone, terminal id) when not adjacent to letters
    .replace(/(^|\s)\d{1,3}(?=\s|$)/g, ' ')
    // dates in M/D, MM/DD, MM-DD-YY formats
    .replace(/\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/g, ' ')
    // trailing 2-letter state-ish tokens at end of line ("ATL GA")
    .replace(/\s[A-Z]{2}\s*$/i, '')
    // collapse
    .replace(/\s+/g, ' ')
    .trim();
  // Take the first ~3 meaningful words.
  const words = cleaned.split(' ').filter((w) => w.length > 1).slice(0, 3);
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
            categories={toAccountingAccountOptions(
              // Banking rules can categorize to anything except bank/cc
              // accounts (which represent funding sources, not categories).
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
