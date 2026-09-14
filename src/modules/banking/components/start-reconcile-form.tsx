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
import { fromCardLiability, toCardLiability } from '@/lib/money';
import {
  startReconciliationAction,
  type ReconcileActionState,
} from '../reconcile-actions';

export type ReconcileAccountOption = {
  id: string;
  name: string;
  last4: string | null;
  currency: string;
  isCreditCard: boolean;
  beginningBalance: number;
  beginningSource: string;
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
  const isCard = selected?.isCreditCard ?? false;
  // On a card the operator works in statement terms — positive = owed — so
  // both balance fields are shown and typed that way and flipped back to the
  // register's sign on submit (see toCardLiability).
  const [beginning, setBeginning] = useState(
    accounts[0]
      ? toCardLiability(
          accounts[0].beginningBalance,
          accounts[0].isCreditCard,
        ).toFixed(2)
      : '0.00',
  );
  const [ending, setEnding] = useState('');
  const signed = (raw: string): string => {
    const n = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(n)) return raw;
    return fromCardLiability(n, isCard).toFixed(2);
  };

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No bank accounts yet — add one under Banking before reconciling.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4 max-w-2xl">
      <div className="flex items-end gap-3">
        <div className="space-y-1.5 flex-1 max-w-xl">
          <Label htmlFor="rec-account">Account</Label>
          <select
            id="rec-account"
            name="bankAccountId"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              const next = accounts.find((a) => a.id === e.target.value);
              if (next) {
                setBeginning(
                  toCardLiability(
                    next.beginningBalance,
                    next.isCreditCard,
                  ).toFixed(2),
                );
              }
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
        </div>
        {/* The auditors' button: the ORIGINAL uploaded statement files,
            unmodified — same placement as QuickBooks' "View statements". */}
        <Link
          href={{
            pathname: '/banking/statements',
            query: accountId ? { account: accountId } : {},
          }}
        >
          <Button type="button" variant="outline">
            View statements
          </Button>
        </Link>
      </div>
      {selected?.lastStatementDate ? (
        <p className="text-xs text-slate-500 -mt-2">
          Last reconciled statement: {selected.lastStatementDate}
        </p>
      ) : (
        <p className="text-xs text-slate-500 -mt-2">
          Never reconciled — the beginning balance below comes from{' '}
          {selected?.beginningSource ?? 'the account'}. Change it here for this
          statement, or fix it for good on the{' '}
          <Link
            href={{ pathname: `/banking/accounts/${accountId}/edit` }}
            className="text-blue-700 underline underline-offset-2"
          >
            account
          </Link>
          .
        </p>
      )}

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
              <Label htmlFor="rec-beginning">
                {isCard ? 'Beginning balance owed' : 'Beginning balance'}
              </Label>
              <Input
                id="rec-beginning"
                inputMode="decimal"
                value={beginning}
                onChange={(e) => setBeginning(e.target.value)}
              />
              <input
                type="hidden"
                name="beginningBalance"
                value={signed(beginning)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-ending">
                {isCard
                  ? 'Statement ending balance owed'
                  : 'Statement ending balance'}
              </Label>
              <Input
                id="rec-ending"
                inputMode="decimal"
                placeholder="0.00"
                value={ending}
                onChange={(e) => setEnding(e.target.value)}
                required
              />
              <input
                type="hidden"
                name="endingBalance"
                value={signed(ending)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-date">Statement ending date</Label>
              <Input id="rec-date" name="statementDate" type="date" required />
            </div>
          </div>

          {isCard && (
            <p className="text-xs text-slate-500 -mt-2">
              This is a credit card, so both balances are what you{' '}
              <span className="font-medium">owe</span>: enter them positive,
              the way the card statement prints them. Charges increase the
              balance owed, payments reduce it. Type a negative number only
              when the card is overpaid and the issuer owes you.
            </p>
          )}

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
