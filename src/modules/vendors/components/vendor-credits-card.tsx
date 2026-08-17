'use client';

// Vendor credits on the vendor page: list existing credits with their open
// remainder, plus an add form. Credits are applied to specific bills from
// the bill's (receipt's) own page.

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';
import {
  createVendorCreditAction,
  deleteVendorCreditAction,
  type VendorCreditActionState,
} from '../credit-actions';

export type VendorCreditView = {
  id: string;
  creditDate: string;
  amount: number;
  appliedTotal: number;
  categoryName: string;
  reference: string | null;
  notes: string | null;
};

export function VendorCreditsCard({
  vendorId,
  credits,
  accountOptions,
  canEdit,
}: {
  vendorId: string;
  credits: VendorCreditView[];
  accountOptions: AccountingAccountOption[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [state, formAction, pending] = useActionState<
    VendorCreditActionState,
    FormData
  >(async (prev, fd) => {
    const res = await createVendorCreditAction(prev, fd);
    if (res.ok) {
      setAdding(false);
      setCategoryId('');
    }
    return res;
  }, {});

  const open = credits.filter((c) => c.amount - c.appliedTotal > 0.005);
  const openTotal = open.reduce((s, c) => s + (c.amount - c.appliedTotal), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            Vendor credits ({credits.length})
            {openTotal > 0.005 && (
              <span className="ml-2 text-sm font-normal text-emerald-700">
                {formatMoney(Math.round(openTotal * 100) / 100)} available
              </span>
            )}
          </CardTitle>
          {canEdit && !adding && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              + Add credit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className={credits.length === 0 && !adding ? '' : 'space-y-4'}>
        {adding && (
          <form action={formAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="vendorId" value={vendorId} />
            <div className="space-y-1.5">
              <Label htmlFor="vc-date">Credit date</Label>
              <Input id="vc-date" name="creditDate" type="date" required className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vc-amount">Amount</Label>
              <Input
                id="vc-amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                required
                className="w-28"
              />
            </div>
            <div className="space-y-1.5 w-60">
              <Label htmlFor="vc-category">Reduces category</Label>
              <AccountingAccountPicker
                id="vc-category"
                name="accountingAccountId"
                value={categoryId}
                onChange={setCategoryId}
                accounts={accountOptions}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vc-ref">Reference (optional)</Label>
              <Input
                id="vc-ref"
                name="reference"
                placeholder="Credit memo #"
                className="w-40"
              />
            </div>
            <div className="space-y-1.5 w-64">
              <Label htmlFor="vc-notes">Notes (optional)</Label>
              <Input id="vc-notes" name="notes" placeholder="What it's for" />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save credit'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            {state.formError && (
              <p className="w-full text-sm text-red-600">{state.formError}</p>
            )}
          </form>
        )}

        {credits.length === 0 ? (
          !adding && (
            <p className="text-sm text-slate-500">
              No credits from this vendor. Record one here when they issue a
              credit memo, then apply it against a bill from the bill&apos;s
              page — the bank payment should then match the bill&apos;s
              remaining due.
            </p>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Reduces</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credits.map((c) => {
                const available =
                  Math.round((c.amount - c.appliedTotal) * 100) / 100;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="tabular-nums text-slate-700">
                      {c.creditDate}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {c.reference ?? '—'}
                      {c.notes && (
                        <span className="text-slate-400"> · {c.notes}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {c.categoryName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(c.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">
                      {formatMoney(c.appliedTotal)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        available > 0.005 ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {formatMoney(available)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && c.appliedTotal < 0.005 && (
                        <DeleteCreditButton creditId={c.id} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteCreditButton({ creditId }: { creditId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('Delete this unapplied credit? Its GL entry is removed too.')) return;
          setError(null);
          startTransition(async () => {
            const res = await deleteVendorCreditAction(creditId);
            if (res.formError) setError(res.formError);
          });
        }}
        className="text-xs text-red-600 underline underline-offset-2 hover:text-red-800"
      >
        {pending ? '…' : 'Delete'}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
