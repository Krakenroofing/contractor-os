'use client';

// QB-style "Which account do you want to reconcile?" form. The beginning
// balance comes from the last completed reconciliation's ending balance (or
// the account's opening balance) and is editable — earlier months may never
// have been reconciled, so the operator can align to any statement.

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  startReconciliationAction,
  type ReconcileActionState,
} from '../reconcile-actions';

export type ReconcileAccountOption = {
  id: string;
  name: string;
  last4: string | null;
  currency: string;
  beginningBalance: number;
  lastStatementDate: string | null;
  openReconciliationId: string | null;
};

export function StartReconcileForm({
  accounts,
}: {
  accounts: ReconcileAccountOption[];
}) {
  const [state, formAction, pending] = useActionState<
    ReconcileActionState,
    FormData
  >(startReconciliationAction, {});
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const selected = accounts.find((a) => a.id === accountId);
  const [beginning, setBeginning] = useState(
    accounts[0] ? accounts[0].beginningBalance.toFixed(2) : '0.00',
  );

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No bank accounts yet — add one under Banking before reconciling.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4 max-w-xl">
      <div className="space-y-1.5">
        <Label htmlFor="rec-account">Account</Label>
        <select
          id="rec-account"
          name="bankAccountId"
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            const next = accounts.find((a) => a.id === e.target.value);
            if (next) setBeginning(next.beginningBalance.toFixed(2));
          }}
          className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.last4 ? ` ····${a.last4}` : ''} ({a.currency})
            </option>
          ))}
        </select>
        {selected?.lastStatementDate && (
          <p className="text-xs text-slate-500">
            Last reconciled statement: {selected.lastStatementDate}
          </p>
        )}
      </div>

      {selected?.openReconciliationId ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
          <p>This account has a reconciliation in progress.</p>
          <Link
            href={{
              pathname: `/banking/reconcile/${selected.openReconciliationId}`,
            }}
          >
            <Button type="button" size="sm">
              Resume reconciling
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-beginning">Beginning balance</Label>
              <Input
                id="rec-beginning"
                name="beginningBalance"
                inputMode="decimal"
                value={beginning}
                onChange={(e) => setBeginning(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-ending">Statement ending balance</Label>
              <Input
                id="rec-ending"
                name="endingBalance"
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-date">Statement ending date</Label>
              <Input id="rec-date" name="statementDate" type="date" required />
            </div>
          </div>

          {state.formError && (
            <p className="text-sm text-red-600">{state.formError}</p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? 'Starting…' : 'Start reconciling'}
          </Button>
        </>
      )}
    </form>
  );
}
