'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createBankAccountAction,
  type BankingActionState,
} from '../actions';
import {
  bankAccountTypeValues,
  BANK_ACCOUNT_TYPE_LABEL,
} from '../schema';

export function BankAccountForm({
  defaultCurrency,
}: {
  defaultCurrency: string;
}) {
  const [state, action, pending] = useActionState<BankingActionState, FormData>(
    createBankAccountAction,
    {},
  );
  return (
    <form action={action} className="space-y-4 max-w-xl">
      <div>
        <Label htmlFor="name">Account name</Label>
        <Input id="name" name="name" required placeholder="TRB Checking" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="type">Type</Label>
          <Select id="type" name="type" defaultValue="bank">
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
            defaultValue={defaultCurrency}
            maxLength={3}
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="last4">Last 4 (optional)</Label>
          <Input id="last4" name="last4" maxLength={8} placeholder="1234" />
        </div>
        <div>
          <Label htmlFor="openingBalance">Opening balance</Label>
          <Input
            id="openingBalance"
            name="openingBalance"
            inputMode="decimal"
            defaultValue="0.00"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="openingDate">Opening date (optional)</Label>
        <Input id="openingDate" name="openingDate" type="date" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add account'}
        </Button>
      </div>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && !state.formError && (
        <p className="text-xs text-emerald-700">Account created.</p>
      )}
    </form>
  );
}
