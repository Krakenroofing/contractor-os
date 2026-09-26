'use client';

// 3-way match card on a bill raised from a GR/IR purchase order: PO price
// vs billed price, received qty vs billed qty, per line — and the payment
// block that a mismatch puts on a posted bill.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BillMatchLine } from '@/lib/data/three-way-match';
import {
  recheckPaymentBlockAction,
  releasePaymentBlockAction,
} from '../actions';

const money = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
const qty = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 4 });

export function ThreeWayMatchPanel(props: {
  receiptId: string;
  poNumber: string | null;
  status: 'draft' | 'submitted' | 'posted' | 'void';
  lines: BillMatchLine[];
  issues: string[];
  paymentBlocked: boolean;
  blockReason: string | null;
  releasedAt: string | null;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const posted = props.status === 'posted';

  function release() {
    if (
      !window.confirm(
        'Release this bill for payment despite the mismatch?\n\nYour note and name are kept on the bill.',
      )
    )
      return;
    setMsg(null);
    startTransition(async () => {
      const res = await releasePaymentBlockAction({ id: props.receiptId, note });
      if (!res.ok) setMsg(res.error ?? 'Could not release.');
      router.refresh();
    });
  }

  function recheck() {
    setMsg(null);
    startTransition(async () => {
      const res = await recheckPaymentBlockAction({ id: props.receiptId });
      if (!res.ok) setMsg(res.error ?? 'Could not re-check.');
      else
        setMsg(
          res.stillBlocked
            ? 'Still outside tolerance — the block stays.'
            : 'Now within tolerance — released for payment.',
        );
      router.refresh();
    });
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>3-way match{props.poNumber ? ` · ${props.poNumber}` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {posted && props.paymentBlocked && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            <div className="font-medium">⛔ Blocked for payment</div>
            <p className="mt-0.5 whitespace-pre-line">
              {props.blockReason ?? props.issues.join('\n')}
            </p>
          </div>
        )}
        {posted && !props.paymentBlocked && props.releasedAt && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Released for payment on {props.releasedAt} despite a mismatch.
            {props.blockReason ? (
              <p className="mt-0.5 whitespace-pre-line">{props.blockReason}</p>
            ) : null}
          </div>
        )}
        {!posted && props.issues.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Outside tolerance — posting will block this bill for payment until
            it’s released:
            <ul className="mt-1 list-disc pl-4">
              {props.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        {props.issues.length === 0 && !props.paymentBlocked && (
          <p className="text-xs text-emerald-700">
            ✓ Quantities and prices agree with the PO and goods received.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 pr-2">Line</th>
                <th className="py-1 pr-2 text-right">Rcvd</th>
                <th className="py-1 pr-2 text-right">Billed</th>
                <th className="py-1 pr-2 text-right">PO price</th>
                <th className="py-1 text-right">Bill price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {props.lines.map((l) => (
                <tr key={l.receiptLineId}>
                  <td className="py-1 pr-2 text-slate-700">
                    <span className="line-clamp-2">{l.description}</span>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {qty(l.quantityReceived)}
                  </td>
                  <td
                    className={`py-1 pr-2 text-right tabular-nums ${l.qtyIssue ? 'font-medium text-red-700' : ''}`}
                    title={
                      l.quantityBilledElsewhere
                        ? `${qty(l.quantityBilledElsewhere)} already billed on other bills`
                        : undefined
                    }
                  >
                    {qty(l.quantityBilled)}
                    {l.quantityBilledElsewhere ? (
                      <span className="text-slate-400">
                        {' '}
                        (+{qty(l.quantityBilledElsewhere)})
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {money(l.poUnitCost)}
                  </td>
                  <td
                    className={`py-1 text-right tabular-nums ${l.priceIssue ? 'font-medium text-red-700' : ''}`}
                  >
                    {l.billedUnitCost === null ? '—' : money(l.billedUnitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">
          The goods receipt already booked this cost at the PO price; the bill
          clears it (GR/IR), and only a price difference posts as extra cost.
        </p>

        {posted && props.canApprove && props.paymentBlocked && (
          <div className="space-y-2 border-t border-slate-200 pt-2">
            <Input
              placeholder="Why release? (kept on the bill)"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={recheck}
              >
                {pending ? '…' : 'Re-check match'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={release}
              >
                Release for payment
              </Button>
            </div>
          </div>
        )}
        {msg && <p className="text-xs text-slate-700">{msg}</p>}
      </CardContent>
    </Card>
  );
}
