'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  uploadStatementAction,
  type BankingActionState,
} from '../actions';
import { BankAccountPicker } from './bank-account-picker';
import { BANK_ACCOUNT_TYPE_LABEL } from '../schema';

type AccountOption = {
  id: string;
  name: string;
  type: 'bank' | 'credit_card';
  last4: string | null;
};

const ACCEPT =
  '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function UploadStatementForm({
  accounts,
}: {
  accounts: AccountOption[];
}) {
  const [state, action, pending] = useActionState<BankingActionState, FormData>(
    uploadStatementAction,
    {},
  );
  return (
    <form action={action} className="space-y-4 max-w-xl">
      <div>
        <Label htmlFor="bankAccountId">Bank account</Label>
        <BankAccountPicker
          id="bankAccountId"
          name="bankAccountId"
          required
          allowNone={false}
          placeholder="Select an account…"
          accounts={accounts.map((a) => ({
            id: a.id,
            label: `${a.name} — ${BANK_ACCOUNT_TYPE_LABEL[a.type]}${
              a.last4 ? ` (****${a.last4})` : ''
            }`,
          }))}
        />
      </div>
      <div>
        <Label htmlFor="file">Statement file (CSV or XLSX, ≤ 10 MB)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept={ACCEPT}
          required
          className="bg-white"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          You&apos;ll map columns and preview totals before any rows are imported.
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Uploading…' : 'Upload &amp; continue'}
      </Button>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
