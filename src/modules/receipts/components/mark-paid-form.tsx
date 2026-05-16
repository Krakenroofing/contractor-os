'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { markReimbursementPaidAction } from '../payout-actions';

export type MarkPaidFormProps = {
  paidToUserId: string;
  paidToUserName: string;
  currency: string;
  lineIds: string[];
  totalOwed: number;
  bankAccounts: Array<{ id: string; label: string }>;
};

const PAID_VIA_OPTIONS = ['Check', 'ACH', 'Cash', 'Venmo', 'Other'] as const;

// Inline "Mark as paid" form per payee group. Opens on click, posts to the
// server action, refreshes the page on success.
export function MarkPaidForm(props: MarkPaidFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [paidAt, setPaidAt] = useState(today);
  const [paidVia, setPaidVia] = useState<string>('Check');
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await markReimbursementPaidAction({
        paidToUserId: props.paidToUserId,
        paidAt,
        paidVia,
        reference,
        bankAccountId,
        notes,
        currency: props.currency,
        lineIds: props.lineIds,
      });
      if (res.formError) {
        setError(res.formError);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={props.lineIds.length === 0}
      >
        Mark {props.totalOwed.toFixed(2)} {props.currency} as paid to{' '}
        {props.paidToUserName}
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-2 rounded-md border border-slate-200 p-3 space-y-3 bg-white"
    >
      <div className="text-xs font-medium text-slate-700">
        Record payout to {props.paidToUserName} — {props.totalOwed.toFixed(2)}{' '}
        {props.currency} covering {props.lineIds.length} line
        {props.lineIds.length === 1 ? '' : 's'}.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label htmlFor="mp-date">Paid on</Label>
          <Input
            id="mp-date"
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="mp-via">Paid via</Label>
          <Select
            id="mp-via"
            value={paidVia}
            onChange={(e) => setPaidVia(e.target.value)}
          >
            {PAID_VIA_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="mp-ref">Reference (optional)</Label>
          <Input
            id="mp-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Check # / ACH ID"
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="mp-bank">From bank account (optional)</Label>
          <Select
            id="mp-bank"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
          >
            <option value="">— none —</option>
            {props.bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-3">
          <Label htmlFor="mp-notes">Notes (optional)</Label>
          <Input
            id="mp-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Confirm payout'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
