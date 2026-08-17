'use client';

// Vendor credits on a bill (receipt): shows what's applied, the remaining
// due (total − credits — the figure the bank payment should match), and an
// apply form listing the vendor's open credits.

import { useActionState, useState, useTransition } from 'react';
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

export type OpenCreditOption = {
  creditId: string;
  creditDate: string;
  reference: string | null;
  available: number;
};

export function ReceiptVendorCreditsCard({
  receiptId,
  receiptTotal,
  applied,
  openCredits,
  canEdit,
}: {
  receiptId: string;
  receiptTotal: number;
  applied: AppliedCreditView[];
  openCredits: OpenCreditOption[];
  canEdit: boolean;
}) {
  const appliedTotal =
    Math.round(applied.reduce((s, a) => s + a.amount, 0) * 100) / 100;
  const remaining = Math.round((receiptTotal - appliedTotal) * 100) / 100;
  const [applying, setApplying] = useState(false);
  const [creditId, setCreditId] = useState(openCredits[0]?.creditId ?? '');
  const selected = openCredits.find((c) => c.creditId === creditId);
  const suggested = selected
    ? Math.min(selected.available, remaining).toFixed(2)
    : '';
  const [state, formAction, pending] = useActionState<
    VendorCreditActionState,
    FormData
  >(async (prev, fd) => {
    const res = await applyVendorCreditAction(prev, fd);
    if (res.ok) setApplying(false);
    return res;
  }, {});

  // Nothing to show: no credits applied and none available to apply.
  if (applied.length === 0 && openCredits.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor credits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {applied.length > 0 && (
          <ul className="space-y-1.5">
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

        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
          <span className="font-medium text-slate-700">
            Remaining due (bank payment should match)
          </span>
          <span className="tabular-nums font-semibold text-slate-900">
            {formatMoney(remaining)}
          </span>
        </div>

        {canEdit && openCredits.length > 0 && remaining > 0.005 && (
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
