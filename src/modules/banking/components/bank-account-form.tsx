'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createBankAccountAction,
  updateBankAccountAction,
  type BankingActionState,
} from '../actions';
import {
  bankAccountTypeValues,
  BANK_ACCOUNT_TYPE_LABEL,
} from '../schema';

export type BankAccountFormInitial = {
  id: string;
  name: string;
  type: string;
  last4: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
};

/** Create form by default; pass `initial` (with the account id) for edit —
 *  same fields, the update action also keeps the paired chart-of-accounts
 *  entry in sync (name / bank-vs-CC type / currency). */
export function BankAccountForm({
  defaultCurrency,
  initial,
}: {
  defaultCurrency: string;
  initial?: BankAccountFormInitial;
}) {
  const isEdit = !!initial;
  const [state, action, pending] = useActionState<BankingActionState, FormData>(
    isEdit ? updateBankAccountAction : createBankAccountAction,
    {},
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={action} className="space-y-4 max-w-xl">
      {isEdit && <input type="hidden" name="id" value={initial.id} />}
      <div>
        <Label htmlFor="name">Account name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={initial?.name ?? ''}
          placeholder="TRB Checking"
        />
        {err('name') && <p className="text-xs text-red-600">{err('name')}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="type">Type</Label>
          <Select id="type" name="type" defaultValue={initial?.type ?? 'bank'}>
            {bankAccountTypeValues.map((v) => (
              <option key={v} value={v}>
                {BANK_ACCOUNT_TYPE_LABEL[v]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            name="currency"
            defaultValue={initial?.currency ?? defaultCurrency}
            maxLength={3}
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="last4">Last 4 (optional)</Label>
          <Input
            id="last4"
            name="last4"
            maxLength={8}
            defaultValue={initial?.last4 ?? ''}
            placeholder="1234"
          />
        </div>
        <div>
          <Label htmlFor="openingBalance">Opening balance</Label>
          <Input
            id="openingBalance"
            name="openingBalance"
            inputMode="decimal"
            defaultValue={initial?.openingBalance ?? '0.00'}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="openingDate">Opening date (optional)</Label>
        <Input
          id="openingDate"
          name="openingDate"
          type="date"
          defaultValue={initial?.openingDate ?? ''}
        />
      </div>
      {isEdit && (
        <p className="text-xs text-slate-500">
          Changing the type between bank and credit card also moves the paired
          Chart-of-Accounts entry (asset ↔ liability). Opening-balance changes
          reshape the register&apos;s running balance immediately; the balance
          sheet follows on the next GL rebuild.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add account'}
        </Button>
      </div>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && !state.formError && (
        <p className="text-xs text-emerald-700">
          {isEdit ? 'Account updated.' : 'Account created.'}
        </p>
      )}
    </form>
  );
}
