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
  /** GR/IR orders: received but not yet billed — the default to bill.
   *  Null for older POs (they default to the unbilled remainder). */
  receivedNotBilledQty?: number | null;
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
  poTaxAmount,
  poSubtotal,
  poShipping,
  priorBillCount,
  grir = false,
}: {
  /** The PO uses GR/IR — no receive-with-bill shortcut. */
  grir?: boolean;
  poId: string;
  lines: PoBillLine[];
  /** The PO's sales tax + subtotal — prefill the tax field with the
   *  selected lines' proportional share. */
  poTaxAmount: number;
  poSubtotal: number;
  /** The PO's shipping/handling charge, and whether earlier bills exist
   *  (shipping is billed once — prefilled only on the FIRST bill). */
  poShipping: number;
  priorBillCount: number;
}) {
  const [state, formAction, pending] = useActionState<
    CreateBillFromPoState,
    FormData
  >(createBillFromPoAction, {});

  const [rows, setRows] = useState<Record<string, LineState>>(() => {
    const init: Record<string, LineState> = {};
    for (const l of lines) {
      if (l.receivedNotBilledQty != null) {
        const qty = Math.round(l.receivedNotBilledQty * 10000) / 10000;
        const amount = r2(qty * l.unitCost);
        init[l.id] = {
          checked: qty > 0,
          quantity: qty !== 0 ? String(qty) : '',
          amount: amount.toFixed(2),
        };
        continue;
      }
      // Signed on purpose: a PO credit line (negative total) bills as a
      // negative amount, so "remaining" can be below zero and still count.
      const remaining = r2(l.lineTotal - l.billedAmount);
      const qty =
        l.unitCost !== 0
          ? Math.round((remaining / l.unitCost) * 10000) / 10000
          : 0;
      init[l.id] = {
        checked: Math.abs(remaining) > 0.004,
        quantity: qty !== 0 ? String(qty) : '',
        amount: Math.abs(remaining) > 0.004 ? remaining.toFixed(2) : '0.00',
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
      if (!Number.isFinite(amount) || amount === 0) continue;
      const quantity = Number(s.quantity);
      out.push({
        poLineId: l.id,
        amount: r2(amount),
        ...(Number.isFinite(quantity) && quantity !== 0 ? { quantity } : {}),
      });
    }
    return JSON.stringify(out);
  }, [lines, rows]);

  const selected = JSON.parse(linesJson) as { amount: number }[];
  const selectedTotal = r2(selected.reduce((s, l) => s + l.amount, 0));

  // Supplier sales tax rides as ONE separate line on the bill (visible,
  // removable when credited back). Prefill = the selected lines' share of
  // the PO's tax; the operator can override or zero it.
  const suggestedTax =
    poTaxAmount !== 0 && poSubtotal !== 0
      ? r2(poTaxAmount * Math.min(1, Math.abs(selectedTotal / poSubtotal)))
      : 0;
  const [taxTouched, setTaxTouched] = useState(false);
  const [salesTax, setSalesTax] = useState('');
  const taxValue = taxTouched ? salesTax : suggestedTax !== 0 ? suggestedTax.toFixed(2) : '';
  const taxNum = Number(taxValue) || 0;

  // Shipping / handling (pallet surcharges, loading charges, freight) —
  // its own line on the bill, categorized to the shipping/freight
  // account. Usually invoiced once, so prefill only on the first bill.
  const suggestedShipping = priorBillCount === 0 ? r2(poShipping) : 0;
  const [shipTouched, setShipTouched] = useState(false);
  const [shippingCharge, setShippingCharge] = useState('');
  const shipValue = shipTouched
    ? shippingCharge
    : suggestedShipping !== 0
      ? suggestedShipping.toFixed(2)
      : '';
  const shipNum = Number(shipValue) || 0;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="poId" value={poId} />
      <input type="hidden" name="linesJson" value={linesJson} />
      <input type="hidden" name="salesTax" value={taxValue || '0'} />
      <input type="hidden" name="shippingCharge" value={shipValue || '0'} />

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
                    {l.billedAmount !== 0 && (
                      <span
                        className={`text-[11px] ${Math.abs(remaining) <= 0.004 ? 'text-emerald-700' : 'text-amber-700'}`}
                      >
                        {Math.abs(remaining) <= 0.004
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
                    {l.billedAmount !== 0 ? fmt(l.billedAmount) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      step="0.0001"
                      value={s.quantity}
                      disabled={!s.checked}
                      onChange={(e) => {
                        const q = Number(e.target.value);
                        setRow(l.id, {
                          quantity: e.target.value,
                          amount:
                            Number.isFinite(q) && l.unitCost !== 0
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

      {/* GR/IR orders: receiving is its own step (it books the cost); the
          bill is 3-way matched against it. Legacy orders keep the shortcut:
          the vendor invoices what shipped, so the invoice can double as the
          receiving document. */}
      {grir ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          This order uses goods receipts (GR/IR). Record what arrived with{' '}
          <span className="font-medium">Receive</span> on the PO — the bill is
          then matched against it on quantity and price. A bill for more than
          was received, or at a different price, posts but is blocked for
          payment until released.
        </div>
      ) : (
      <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="markReceived"
          value="1"
          defaultChecked
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          Mark these quantities received
          <span className="block text-xs text-slate-500">
            The vendor bills what they shipped, so the invoice doubles as the
            packing slip. A shipment is recorded for the quantities above (never
            more than what&apos;s still outstanding on each line) and the PO
            advances to partially received / received. Untick if this invoice
            is for goods that haven&apos;t arrived.
          </span>
        </span>
      </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-xs font-medium text-slate-600">
            Sales tax on this invoice{' '}
            <span className="font-normal text-slate-400">
              (their tax — separate line, remove when credited)
            </span>
            <Input
              type="number"
              step="0.01"
              value={taxValue}
              onChange={(e) => {
                setTaxTouched(true);
                setSalesTax(e.target.value);
              }}
              className="mt-1 w-32 text-right tabular-nums"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Shipping / charges{' '}
            <span className="font-normal text-slate-400">
              (freight, pallet + loading fees)
            </span>
            <Input
              type="number"
              step="0.01"
              value={shipValue}
              onChange={(e) => {
                setShipTouched(true);
                setShippingCharge(e.target.value);
              }}
              className="mt-1 w-32 text-right tabular-nums"
            />
          </label>
          <p className="text-sm text-slate-600 pb-1.5">
            {selected.length} line{selected.length === 1 ? '' : 's'} — items{' '}
            <span className="font-semibold text-slate-900 tabular-nums">
              {fmt(selectedTotal)}
            </span>
            {shipNum !== 0 && (
              <>
                {' '}+ shipping <span className="tabular-nums">{fmt(shipNum)}</span>
              </>
            )}
            {taxNum !== 0 && (
              <>
                {' '}+ tax <span className="tabular-nums">{fmt(taxNum)}</span>
              </>
            )}
            {(taxNum !== 0 || shipNum !== 0) && (
              <>
                {' '}={' '}
                <span className="font-semibold text-slate-900 tabular-nums">
                  {fmt(r2(selectedTotal + taxNum + shipNum))}
                </span>
              </>
            )}{' '}
            <span className="text-xs text-slate-500">
              (amounts are exactly qty × unit price — no VAT added)
            </span>
          </p>
        </div>
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
