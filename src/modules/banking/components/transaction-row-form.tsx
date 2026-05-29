'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  updateImportedTransactionAction,
  type BankingActionState,
} from '../actions';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';

type Option = { id: string; label: string };

export type TransactionRowFormProps = {
  id: string;
  initial: {
    accountingAccountId: string | null;
    projectId: string | null;
    costCodeId: string | null;
    isReviewed: boolean;
    isIgnored: boolean;
    notes: string | null;
  };
  categories: AccountingAccountOption[];
  projects: Option[];
  costCodes: Option[];
  canEdit: boolean;
};

// Inline editor rendered under each transaction row. Submits to the server
// action with hidden id. No optimistic UI — the page re-renders on response.
export function TransactionRowForm(props: TransactionRowFormProps) {
  const [state, action, pending] = useActionState<BankingActionState, FormData>(
    updateImportedTransactionAction,
    {},
  );
  const [accountingAccountId, setAccountingAccountId] = useState(
    props.initial.accountingAccountId ?? '',
  );
  const [projectId, setProjectId] = useState(props.initial.projectId ?? '');
  const [costCodeId, setCostCodeId] = useState(props.initial.costCodeId ?? '');
  const [isReviewed, setIsReviewed] = useState(props.initial.isReviewed);
  const [isIgnored, setIsIgnored] = useState(props.initial.isIgnored);
  const [notes, setNotes] = useState(props.initial.notes ?? '');

  if (!props.canEdit) {
    return (
      <div className="text-xs text-slate-500 italic">
        View-only role — no edits permitted.
      </div>
    );
  }

  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-12 gap-2">
      <input type="hidden" name="id" value={props.id} />
      <div className="md:col-span-3">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">
          Category
        </span>
        <AccountingAccountPicker
          name="accountingAccountId"
          value={accountingAccountId}
          onChange={(id) => setAccountingAccountId(id)}
          accounts={props.categories}
          placeholder="— select category —"
        />
      </div>
      <div className="md:col-span-3">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">
          Project <span className="normal-case text-slate-400">(optional)</span>
        </span>
        <Select
          name="projectId"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">— no project —</option>
          {props.projects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-3">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">
          Cost code{' '}
          <span className="normal-case text-slate-400">(optional)</span>
        </span>
        <Select
          name="costCodeId"
          value={costCodeId}
          onChange={(e) => setCostCodeId(e.target.value)}
        >
          <option value="">— no cost code —</option>
          {props.costCodes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-2 flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="isReviewed"
            checked={isReviewed}
            onChange={(e) => setIsReviewed(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Reviewed
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="isIgnored"
            checked={isIgnored}
            onChange={(e) => setIsIgnored(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Ignore
        </label>
      </div>
      <div className="md:col-span-1 flex items-center">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '…' : 'Save'}
        </Button>
      </div>
      <div className="md:col-span-12">
        <Input
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="h-9 text-xs"
        />
      </div>
      {state.formError && (
        <p className="md:col-span-12 text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
