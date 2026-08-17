'use client';

// QB-style typed entry on the account register: expense (money out),
// deposit / CC credit (money in), or a transfer between two of our accounts
// (the mirrored entry is created and matched automatically). Journal entries
// live at /accounting/journal — linked from the register toolbar.

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';
import {
  addRegisterTransactionAction,
  type ReconcileActionState,
} from '../reconcile-actions';

type Option = { id: string; label: string };

export function RegisterAddTransaction({
  bankAccountId,
  isCreditCard,
  accountOptions,
  vendorOptions,
  projectOptions,
  otherAccounts,
}: {
  bankAccountId: string;
  isCreditCard: boolean;
  accountOptions: AccountingAccountOption[];
  vendorOptions: Option[];
  projectOptions: Option[];
  otherAccounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [entryType, setEntryType] = useState<'out' | 'in' | 'transfer'>('out');
  const [categoryId, setCategoryId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<
    ReconcileActionState,
    FormData
  >(addRegisterTransactionAction, {});

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setCategoryId('');
      setOpen(false);
    }
  }, [state.ok]);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        + Add transaction
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="py-4 space-y-2">
        <p className="text-xs text-slate-500">
          Type an entry straight into the register — an{' '}
          {isCreditCard ? 'expense / CC credit' : 'expense / deposit'}, or a
          transfer between accounts (the other side is created and matched
          automatically). Entries land in the next reconciliation like any
          statement line.
        </p>
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="bankAccountId" value={bankAccountId} />
          <div className="space-y-1.5">
            <Label htmlFor="reg-type">Type</Label>
            <select
              id="reg-type"
              name="entryType"
              value={entryType}
              onChange={(e) =>
                setEntryType(e.target.value as 'out' | 'in' | 'transfer')
              }
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="out">
                {isCreditCard ? 'CC expense (charge)' : 'Expense (money out)'}
              </option>
              <option value="in">
                {isCreditCard ? 'CC credit / payment received' : 'Deposit (money in)'}
              </option>
              <option value="transfer">Transfer between accounts</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-date">Date</Label>
            <Input
              id="reg-date"
              name="transactionDate"
              type="date"
              required
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-desc">Description</Label>
            <Input
              id="reg-desc"
              name="description"
              placeholder={
                entryType === 'transfer'
                  ? 'e.g. Transfer to payroll account'
                  : 'e.g. Shell West Bay'
              }
              required
              className="w-60"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-amount">Amount</Label>
            <Input
              id="reg-amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              required
              className="w-28"
            />
          </div>

          {entryType === 'transfer' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="reg-transfer-dir">Direction</Label>
                <select
                  id="reg-transfer-dir"
                  name="transferDirection"
                  defaultValue="out"
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="out">Out of this account</option>
                  <option value="in">Into this account</option>
                </select>
              </div>
              <div className="space-y-1.5 w-56">
                <Label htmlFor="reg-transfer-acct">Other account</Label>
                <Select id="reg-transfer-acct" name="transferAccountId" defaultValue="">
                  <option value="">— pick account —</option>
                  {otherAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5 w-60">
                <Label htmlFor="reg-category">Category (optional)</Label>
                <AccountingAccountPicker
                  id="reg-category"
                  name="accountingAccountId"
                  value={categoryId}
                  onChange={setCategoryId}
                  accounts={accountOptions}
                  placeholder="— none —"
                />
              </div>
              <div className="space-y-1.5 w-52">
                <Label htmlFor="reg-vendor">Payee / vendor (optional)</Label>
                <Select id="reg-vendor" name="vendorId" defaultValue="">
                  <option value="">— none —</option>
                  {vendorOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 w-52">
                <Label htmlFor="reg-project">Job / project (optional)</Label>
                <Select id="reg-project" name="projectId" defaultValue="">
                  <option value="">— none —</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          {state.formError && (
            <p className="text-sm text-red-600 w-full">{state.formError}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
