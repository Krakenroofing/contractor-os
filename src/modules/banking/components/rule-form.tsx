'use client';

import { useActionState, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  upsertRuleAction,
  type BankingActionState,
} from '../actions';
import {
  APPLIES_TO_VALUES,
  MATCHER_FIELDS,
  MATCHER_OPS,
  type AppliesTo,
  type Matcher,
  type MatcherField,
  type MatcherOp,
  type RuleActionPayload,
  type RuleForMatching,
  describeReason,
  matchRule,
} from '../lib/rules';

type Option = { id: string; label: string };

export type RuleFormProps = {
  initial?: {
    id?: string;
    name: string;
    enabled: boolean;
    priority: number;
    appliesTo: AppliesTo;
    bankAccountId: string | null;
    amountMin: number | null;
    amountMax: number | null;
    matchers: Matcher[];
    actions: RuleActionPayload;
  };
  bankAccounts: Option[];
  categories: Option[];
  projects: Option[];
  costCodes: Option[];
};

const FIELD_LABEL: Record<MatcherField, string> = {
  description: 'Description',
  payee: 'Payee',
  memo: 'Memo',
  reference: 'Reference',
};
const OP_LABEL: Record<MatcherOp, string> = {
  contains: 'contains',
  equals: 'equals',
  starts_with: 'starts with',
  regex: 'matches regex',
};

export function RuleForm(props: RuleFormProps) {
  const initial = props.initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [priority, setPriority] = useState(initial?.priority ?? 100);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(
    initial?.appliesTo ?? 'all',
  );
  const [bankAccountId, setBankAccountId] = useState(
    initial?.bankAccountId ?? '',
  );
  const [amountMin, setAmountMin] = useState(
    initial?.amountMin?.toString() ?? '',
  );
  const [amountMax, setAmountMax] = useState(
    initial?.amountMax?.toString() ?? '',
  );
  const [matchers, setMatchers] = useState<Matcher[]>(
    initial?.matchers && initial.matchers.length > 0
      ? initial.matchers
      : [{ field: 'description', op: 'contains', value: '', case_sensitive: false }],
  );
  const [actions, setActions] = useState<RuleActionPayload>(
    initial?.actions ?? {
      accountingAccountId: null,
      projectId: null,
      costCodeId: null,
      notes: null,
    },
  );

  const [testText, setTestText] = useState('');

  const [state, action, pending] = useActionState<BankingActionState, FormData>(
    upsertRuleAction,
    {},
  );

  // Test-panel matcher — composes a fake txn from typed text and runs
  // matchRule against the form's current values.
  const testResult = useMemo(() => {
    if (testText.trim() === '') return null;
    const ruleForMatch: RuleForMatching = {
      id: 'preview',
      name: name || '(unnamed)',
      enabled: true,
      priority,
      appliesTo,
      bankAccountId: bankAccountId || null,
      amountMin: amountMin === '' ? null : Number(amountMin) || null,
      amountMax: amountMax === '' ? null : Number(amountMax) || null,
      matchers,
      actions,
    };
    return matchRule(
      {
        bankAccountId: bankAccountId || '__test__',
        description: testText,
        payee: testText,
        memo: testText,
        reference: testText,
        amount: appliesTo === 'debits' ? -1 : 1,
        isReviewed: false,
        isIgnored: false,
        accountingAccountId: null,
        appliedRuleId: null,
      },
      ruleForMatch,
    );
  }, [
    testText,
    name,
    priority,
    appliesTo,
    bankAccountId,
    amountMin,
    amountMax,
    matchers,
    actions,
  ]);

  function updateMatcher(idx: number, patch: Partial<Matcher>) {
    setMatchers((m) => m.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function addMatcher() {
    setMatchers((m) => [
      ...m,
      { field: 'description', op: 'contains', value: '', case_sensitive: false },
    ]);
  }
  function removeMatcher(idx: number) {
    setMatchers((m) => (m.length <= 1 ? m : m.filter((_, i) => i !== idx)));
  }

  return (
    <form action={action} className="space-y-6">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <Label htmlFor="name">Rule name</Label>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Home Depot → Materials"
          />
        </div>
        <div>
          <Label htmlFor="priority">Priority (lower wins)</Label>
          <Input
            id="priority"
            name="priority"
            type="number"
            min={0}
            max={10000}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label htmlFor="appliesTo">Applies to</Label>
          <Select
            id="appliesTo"
            name="appliesTo"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value as AppliesTo)}
          >
            {APPLIES_TO_VALUES.map((v) => (
              <option key={v} value={v}>
                {v === 'all'
                  ? 'All transactions'
                  : v === 'debits'
                    ? 'Debits only (money out)'
                    : 'Credits only (money in)'}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="bankAccountId">Bank account</Label>
          <Select
            id="bankAccountId"
            name="bankAccountId"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
          >
            <option value="">All accounts</option>
            {props.bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="amountMin">Amount min (abs)</Label>
          <Input
            id="amountMin"
            name="amountMin"
            inputMode="decimal"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <Label htmlFor="amountMax">Amount max (abs)</Label>
          <Input
            id="amountMax"
            name="amountMax"
            inputMode="decimal"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Rule is enabled
      </label>

      <div className="rounded-md border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-900">
            Match when ALL of these are true
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addMatcher}>
            + Add condition
          </Button>
        </div>
        <div className="space-y-2">
          {matchers.map((m, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 items-start bg-slate-50 p-2 rounded"
            >
              <input type="hidden" name="matcher_field" value={m.field} />
              <input type="hidden" name="matcher_op" value={m.op} />
              <input type="hidden" name="matcher_value" value={m.value} />
              <input
                type="hidden"
                name="matcher_case"
                value={m.case_sensitive ? 'on' : 'off'}
              />
              <div className="col-span-3">
                <Select
                  value={m.field}
                  onChange={(e) =>
                    updateMatcher(i, { field: e.target.value as MatcherField })
                  }
                >
                  {MATCHER_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABEL[f]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-3">
                <Select
                  value={m.op}
                  onChange={(e) =>
                    updateMatcher(i, { op: e.target.value as MatcherOp })
                  }
                >
                  {MATCHER_OPS.map((o) => (
                    <option key={o} value={o}>
                      {OP_LABEL[o]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-4">
                <Input
                  value={m.value}
                  onChange={(e) => updateMatcher(i, { value: e.target.value })}
                  placeholder={
                    m.op === 'regex' ? 'HOME ?DEPOT.*' : 'HOME DEPOT'
                  }
                />
              </div>
              <label className="col-span-1 inline-flex items-center gap-1 text-[11px] text-slate-600 pt-2">
                <input
                  type="checkbox"
                  checked={m.case_sensitive ?? false}
                  onChange={(e) =>
                    updateMatcher(i, { case_sensitive: e.target.checked })
                  }
                  className="h-3.5 w-3.5"
                />
                Case
              </label>
              <div className="col-span-1 flex justify-end pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={matchers.length <= 1}
                  onClick={() => removeMatcher(i)}
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-900">Then auto-fill</h3>
        <p className="text-xs text-slate-500">
          Applies only to transactions that are not yet reviewed and not yet
          categorized. Phase 1 never overwrites manual work.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="action_accountingAccountId">Category</Label>
            <Select
              id="action_accountingAccountId"
              name="action_accountingAccountId"
              value={actions.accountingAccountId ?? ''}
              onChange={(e) =>
                setActions((a) => ({
                  ...a,
                  accountingAccountId: e.target.value || null,
                }))
              }
            >
              <option value="">— none —</option>
              {props.categories.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="action_projectId">Project</Label>
            <Select
              id="action_projectId"
              name="action_projectId"
              value={actions.projectId ?? ''}
              onChange={(e) =>
                setActions((a) => ({ ...a, projectId: e.target.value || null }))
              }
            >
              <option value="">— none —</option>
              {props.projects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="action_costCodeId">Cost code</Label>
            <Select
              id="action_costCodeId"
              name="action_costCodeId"
              value={actions.costCodeId ?? ''}
              onChange={(e) =>
                setActions((a) => ({
                  ...a,
                  costCodeId: e.target.value || null,
                }))
              }
            >
              <option value="">— none —</option>
              {props.costCodes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="action_notes">Notes to append</Label>
          <Input
            id="action_notes"
            name="action_notes"
            value={(actions.notes as string) ?? ''}
            onChange={(e) =>
              setActions((a) => ({ ...a, notes: e.target.value || null }))
            }
            placeholder="Optional. Rule name is always appended automatically."
          />
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-2">
        <h3 className="text-sm font-medium text-slate-900">
          Test against a sample
        </h3>
        <p className="text-xs text-slate-500">
          Paste a description like it would appear on a statement. The matcher
          runs live against your current form values — nothing is saved.
        </p>
        <Input
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder='e.g. "HOME DEPOT #2143 ATL GA"'
        />
        {testText.trim() !== '' && testResult && (
          <div
            className={
              testResult.matched
                ? 'rounded bg-emerald-50 text-emerald-800 p-2 text-xs'
                : 'rounded bg-slate-100 text-slate-600 p-2 text-xs'
            }
          >
            {testResult.matched ? (
              <>
                <div className="font-semibold">✓ Would match</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {testResult.reasons.map((r, i) => (
                    <li key={i}>{describeReason(r)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <span>No match.</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : initial?.id ? 'Save rule' : 'Create rule'}
        </Button>
        {state.formError && (
          <p className="text-xs text-red-600">{state.formError}</p>
        )}
      </div>
    </form>
  );
}
