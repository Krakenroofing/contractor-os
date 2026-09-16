'use client';

// "Paid so far" on a bill (receipt): the bill total, every bank payment
// matched to it, every vendor credit applied to it, and what's still
// outstanding — so the two ways a bill gets settled are never confused for
// each other. The apply form is capped at the OUTSTANDING balance (total −
// credits − bank money), not at the bill total: a bill already part-paid from
// the bank can only absorb the difference as credit.

import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import {
  applyVendorCreditAction,
  unapplyVendorCreditAction,
  type VendorCreditActionState,
} from '@/modules/vendors/credit-actions';

export type AppliedCreditView = {
  applicationId: string;
  creditDate: string;
  reference: string | null;
  amount: number;
};

export type BankPaymentView = {
  matchId: string;
  importedTransactionId: string;
  bankAccountId: string;
  bankAccountName: string | null;
  transactionDate: string;
  description: string;
  amount: number;
};

export type OpenCreditOption = {
  creditId: string;
  creditDate: string;
  reference: string | null;
  available: number;
};

const round = (n: number) => Math.round(n * 100) / 100;

export function ReceiptVendorCreditsCard({
  receiptId,
  receiptTotal,
  applied,
  bankPayments,
  openCredits,
  canEdit,
}: {
  receiptId: string;
  receiptTotal: number;
  applied: AppliedCreditView[];
  bankPayments: BankPaymentView[];
  openCredits: OpenCreditOption[];
  canEdit: boolean;
}) {
  const creditTotal = round(applied.reduce((s, a) => s + a.amount, 0));
  // Bank money can't settle more than the bill owes after credits — a lump
  // payment covering several bills still only clears this one's share.
  const bankTotal = Math.min(
    round(bankPayments.reduce((s, p) => s + p.amount, 0)),
    Math.max(0, round(receiptTotal - creditTotal)),
  );
  const outstanding = round(
    Math.max(0, receiptTotal - creditTotal - bankTotal),
  );
  const [applying, setApplying] = useState(false);
  const [creditId, setCreditId] = useState(openCredits[0]?.creditId ?? '');
  const selected = openCredits.find((c) => c.creditId === creditId);
  const suggested = selected
    ? Math.min(selected.available, outstanding).toFixed(2)
    : '';
  const [state, formAction, pending] = useActionState<
    VendorCreditActionState,
    FormData
  >(async (prev, fd) => {
    const res = await applyVendorCreditAction(prev, fd);
    if (res.ok) setApplying(false);
    return res;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paid so far</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">Bill total</span>
          <span className="tabular-nums text-slate-900">
            {formatMoney(receiptTotal)}
          </span>
        </div>

        <div className="border-t border-slate-100 pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Paid from the bank
          </p>
          {bankPayments.length === 0 ? (
            <p className="mt-1 text-sm text-slate-400">
              No bank payment matched to this bill yet.
            </p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {bankPayments.map((p) => (
                <li
                  key={p.matchId}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <Link
                    href={
                      `/banking/accounts/${p.bankAccountId}?txn=${p.importedTransactionId}` as never
                    }
                    className="text-blue-700 hover:underline"
                    title="Open this payment in the register"
                  >
                    {p.transactionDate}
                    {p.bankAccountName ? ` · ${p.bankAccountName}` : ''}
                    {p.description ? ` · ${p.description}` : ''}
                  </Link>
                  <span className="tabular-nums whitespace-nowrap text-slate-700">
                    −{formatMoney(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-100 pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Paid with vendor credit
          </p>
          {applied.length === 0 ? (
            <p className="mt-1 text-sm text-slate-400">
              No vendor credit applied to this bill.
            </p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {applied.map((a) => (
                <li
                  key={a.applicationId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-slate-600">
                    Credit {a.reference ?? a.creditDate}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="tabular-nums text-emerald-700">
                      −{formatMoney(a.amount)}
                    </span>
                    {canEdit && (
                      <UnapplyButton applicationId={a.applicationId} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t-2 border-slate-200 pt-2 text-sm">
          <span className="font-medium text-slate-700">
            {outstanding > 0.005
              ? 'Still outstanding'
              : 'Outstanding — settled in full'}
          </span>
          <span
            className={`tabular-nums font-semibold ${
              outstanding > 0.005 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {formatMoney(outstanding)}
          </span>
        </div>

        {canEdit && openCredits.length > 0 && outstanding > 0.005 && (
          applying ? (
            <form action={formAction} className="space-y-2">
              <input type="hidden" name="receiptId" value={receiptId} />
              <div className="space-y-1.5">
                <Label htmlFor="apply-credit">Credit</Label>
                <select
                  id="apply-credit"
                  name="creditId"
                  value={creditId}
                  onChange={(e) => setCreditId(e.target.value)}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  {openCredits.map((c) => (
                    <option key={c.creditId} value={c.creditId}>
                      {c.reference ?? c.creditDate} — {c.available.toFixed(2)}{' '}
                      available
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="apply-amount">Amount to apply</Label>
                <Input
                  id="apply-amount"
                  name="amount"
                  inputMode="decimal"
                  key={creditId}
                  defaultValue={suggested}
                />
                <p className="text-xs text-slate-500">
                  At most {formatMoney(outstanding)} — the bill&apos;s
                  outstanding balance after the bank payments above.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Applying…' : 'Apply credit'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setApplying(false)}
                >
                  Cancel
                </Button>
              </div>
              {state.formError && (
                <p className="text-sm text-red-600">{state.formError}</p>
              )}
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setApplying(true)}
            >
              Apply a vendor credit
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}

function UnapplyButton({ applicationId }: { applicationId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('Remove this credit from the bill? The credit becomes available again.')) return;
          setError(null);
          startTransition(async () => {
            const res = await unapplyVendorCreditAction(applicationId);
            if (res.formError) setError(res.formError);
          });
        }}
        className="text-[11px] text-slate-400 underline underline-offset-2 hover:text-slate-600"
      >
        {pending ? '…' : 'remove'}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
