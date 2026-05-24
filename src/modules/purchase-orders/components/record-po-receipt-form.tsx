'use client';

// Phase 6.1: per-line receiving form. One submission becomes one po_receipts
// row with one or more po_receipt_lines. Lines left blank or set to zero are
// dropped server-side, so the operator can record a partial shipment by
// filling only what actually arrived.
//
// Over-receiving (qty > remaining) is allowed — supplier overshipments are
// common. The UI warns in amber but lets the submit go through; the PO
// status still flips to `received` once every line meets or exceeds ordered.

import { useMemo, useState } from 'react';
import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  recordPoReceiptAction,
  type RecordPoReceiptState,
} from '../actions';

type LineRow = {
  id: string;
  description: string;
  unit: string | null;
  quantityOrdered: number;
  quantityReceivedAlready: number;
};

const initial: RecordPoReceiptState = {};

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function RecordPoReceiptForm({
  poId,
  poNumber,
  lines,
}: {
  poId: string;
  poNumber: string;
  lines: LineRow[];
}) {
  const [state, formAction, pending] = useActionState(
    recordPoReceiptAction,
    initial,
  );

  // One qty input per PO line, keyed by line id. Default to the remaining
  // amount so the common case (a full shipment arrived) is a one-click flow.
  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of lines) {
      const remaining = Math.max(l.quantityOrdered - l.quantityReceivedAlready, 0);
      init[l.id] = remaining > 0 ? String(remaining) : '';
    }
    return init;
  });

  const linesJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) => ({
          poLineId: l.id,
          quantityReceived: qtys[l.id] || '0',
        })),
      ),
    [lines, qtys],
  );

  const totalNow = useMemo(
    () =>
      lines.reduce((acc, l) => {
        const v = Number(qtys[l.id] || '0');
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0),
    [lines, qtys],
  );

  const hasOverReceive = lines.some((l) => {
    const v = Number(qtys[l.id] || '0');
    const remaining = l.quantityOrdered - l.quantityReceivedAlready;
    return v > remaining && remaining >= 0;
  });

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <input type="hidden" name="purchaseOrderId" value={poId} />
      <input type="hidden" name="lines" value={linesJson} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Received date" error={state.errors?.receivedDate?.[0]}>
          <Input
            name="receivedDate"
            type="date"
            defaultValue={todayLocalISO()}
            required
          />
        </Field>
        <Field
          label="Notes (optional)"
          error={state.errors?.notes?.[0]}
        >
          <Input
            name="notes"
            placeholder="Packing slip #, driver, condition…"
            maxLength={2000}
          />
        </Field>
      </div>

      <div className="rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Already received</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="text-right w-40">Receive now</TableHead>
              <TableHead>Unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const remaining = l.quantityOrdered - l.quantityReceivedAlready;
              const v = Number(qtys[l.id] || '0');
              const over = v > remaining;
              return (
                <TableRow key={l.id}>
                  <TableCell className="text-slate-900">{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtQty(l.quantityOrdered)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {fmtQty(l.quantityReceivedAlready)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      remaining <= 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {fmtQty(Math.max(remaining, 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      className={`text-right tabular-nums ${
                        over ? 'border-amber-400 bg-amber-50' : ''
                      }`}
                      value={qtys[l.id] ?? ''}
                      onChange={(e) =>
                        setQtys((prev) => ({ ...prev, [l.id]: e.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-slate-600">{l.unit ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {hasOverReceive && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          One or more lines are over the remaining quantity. That&apos;s allowed
          — the supplier may have overshipped — but the PO will still flip to
          &quot;received&quot; once every line meets ordered. Adjust the PO line
          quantity later if you want the totals to match.
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Recording{' '}
          <span className="font-medium tabular-nums">{fmtQty(totalNow)}</span> total
          unit{totalNow === 1 ? '' : 's'} across this shipment for PO{' '}
          <span className="font-mono">{poNumber}</span>.
        </p>
        <div className="flex items-center gap-3">
          <Link href={{ pathname: `/purchase-orders/${poId}` }}>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={pending || totalNow <= 0}>
            {pending ? 'Saving…' : 'Save receipt'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
