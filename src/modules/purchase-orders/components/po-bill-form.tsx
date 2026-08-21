'use client';

// PO → bill: pick which lines (and how much of each) the vendor's invoice
// covers. Partial shipments are the norm, so each line defaults to its
// REMAINING un-billed amount and can be trimmed further. Submits to
// createBillFromPoAction which creates the draft bill and redirects to it.

import { useActionState, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createBillFromPoAction,
  type CreateBillFromPoState,
} from '../actions';

export type PoBillLine = {
  id: string;
  description: string;
  unit: string | null;
  quantityOrdered: number;
  unitCost: number;
  lineTotal: number;
  billedAmount: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type LineState = {
  checked: boolean;
  quantity: string;
  amount: string;
};

export function PoBillForm({
  poId,
  lines,
}: {
  poId: string;
  lines: PoBillLine[];
}) {
  const [state, formAction, pending] = useActionState<
    CreateBillFromPoState,
    FormData
  >(createBillFromPoAction, {});

  const [rows, setRows] = useState<Record<string, LineState>>(() => {
    const init: Record<string, LineState> = {};
    for (const l of lines) {
      const remaining = r2(l.lineTotal - l.billedAmount);
      const qty =
        l.unitCost > 0 ? Math.round((remaining / l.unitCost) * 10000) / 10000 : 0;
      init[l.id] = {
        checked: remaining > 0.004,
        quantity: qty > 0 ? String(qty) : '',
        amount: remaining > 0.004 ? remaining.toFixed(2) : '0.00',
      };
    }
    return init;
  });

  function setRow(id: string, patch: Partial<LineState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const linesJson = useMemo(() => {
    const out: { poLineId: string; amount: number; quantity?: number }[] = [];
    for (const l of lines) {
      const s = rows[l.id];
      if (!s?.checked) continue;
      const amount = Number(s.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const quantity = Number(s.quantity);
      out.push({
        poLineId: l.id,
        amount: r2(amount),
        ...(Number.isFinite(quantity) && quantity > 0 ? { quantity } : {}),
      });
    }
    return JSON.stringify(out);
  }, [lines, rows]);

  const selected = JSON.parse(linesJson) as { amount: number }[];
  const selectedTotal = r2(selected.reduce((s, l) => s + l.amount, 0));

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="poId" value={poId} />
      <input type="hidden" name="linesJson" value={linesJson} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-xs font-medium text-slate-600">
          Vendor invoice #{' '}
          <span className="font-normal text-slate-400">
            (from their paperwork)
          </span>
          <Input
            name="vendorInvoiceNumber"
            required
            placeholder="e.g. INV-10442"
            className="mt-1"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Bill date
          <Input
            type="date"
            name="billDate"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="mt-1"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Bill</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Ordered</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">Already billed</th>
              <th className="px-3 py-2 text-right">Qty now</th>
              <th className="px-3 py-2 text-right">Amount now (net)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const s = rows[l.id];
              const remaining = r2(l.lineTotal - l.billedAmount);
              return (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={s.checked}
                      onChange={(e) => setRow(l.id, { checked: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="max-w-[18rem] px-3 py-2">
                    <span className="block truncate" title={l.description}>
                      {l.description}
                    </span>
                    {l.billedAmount > 0 && (
                      <span
                        className={`text-[11px] ${remaining <= 0.004 ? 'text-emerald-700' : 'text-amber-700'}`}
                      >
                        {remaining <= 0.004
                          ? 'Fully billed'
                          : `${fmt(remaining)} left to bill`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {l.quantityOrdered}
                    {l.unit ? ` ${l.unit}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {fmt(l.unitCost)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {l.billedAmount > 0 ? fmt(l.billedAmount) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={s.quantity}
                      disabled={!s.checked}
                      onChange={(e) => {
                        const q = Number(e.target.value);
                        setRow(l.id, {
                          quantity: e.target.value,
                          amount:
                            Number.isFinite(q) && l.unitCost > 0
                              ? r2(q * l.unitCost).toFixed(2)
                              : s.amount,
                        });
                      }}
                      className="h-8 w-24 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={s.amount}
                      disabled={!s.checked}
                      onChange={(e) => setRow(l.id, { amount: e.target.value })}
                      className="h-8 w-28 text-right text-xs tabular-nums"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {selected.length} line{selected.length === 1 ? '' : 's'} selected —
          net total{' '}
          <span className="font-semibold text-slate-900 tabular-nums">
            {fmt(selectedTotal)}
          </span>{' '}
          <span className="text-xs text-slate-500">
            (VAT is added on the draft; review before posting)
          </span>
        </p>
        <Button type="submit" disabled={pending || selected.length === 0}>
          {pending ? 'Creating bill…' : 'Create draft bill'}
        </Button>
      </div>
      {state.formError && (
        <p className="text-sm text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
