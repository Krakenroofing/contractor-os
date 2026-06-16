'use client';

import { useEffect, useState, useTransition } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createBankAccountInlineAction,
  type InlineBankAccount,
} from '../actions';
import { BANK_ACCOUNT_TYPE_LABEL, bankAccountTypeValues } from '../schema';

// Slide-over "+ Add new bank account" form. Creates the account (and its
// paired chart-of-accounts row) and selects it here. Opening balance / date
// can be set later on the Banking page; this just unblocks an upload or a
// payment that references an account not yet registered.
export function QuickAddBankAccountDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: InlineBankAccount) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('bank');
  const [last4, setLast4] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName('');
    setType('bank');
    setLast4('');
    setError(null);
  }, [open]);

  function save() {
    if (name.trim() === '') {
      setError('Account name is required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createBankAccountInlineAction({ name, type, last4 });
      if (!res.ok) {
        setError(
          res.error ??
            res.errors?.name?.[0] ??
            'Could not create the bank account.',
        );
        return;
      }
      onCreated(res.item);
      onClose();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add bank account"
      description="Registers the account (and its chart-of-accounts category) and selects it here. Set the opening balance later on the Banking page."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>
            Account name<span className="ml-0.5 text-red-600">*</span>
          </Label>
          <Input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Operating — RBC"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {bankAccountTypeValues.map((t) => (
                <option key={t} value={t}>
                  {BANK_ACCOUNT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Last 4 (optional)</Label>
            <Input
              value={last4}
              inputMode="numeric"
              maxLength={4}
              onChange={(e) => setLast4(e.target.value)}
              placeholder="1234"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Add & select'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
