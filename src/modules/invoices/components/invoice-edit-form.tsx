'use client';

// Full-form invoice edit. Mirrors the structure of <InvoiceForm> for create
// (line items, totals, retainage, tax, dates, notes, terms) but submits to
// `updateInvoiceFullAction` and treats customer / project / invoice number
// as read-only — those changes belong to the void+recreate flow because
// they break the audit trail.
//
// Existing payments stay linked across edits: the action layer calls
// `recomputeInvoicePaymentState` after the totals change, so amount_paid +
// status auto-derive against the new total.

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { add, formatMoney, multiply, subtract } from '@/lib/money';
import {
  updateInvoiceFullAction,
  type CreateInvoiceState as UpdateInvoiceState,
} from '../actions';
import {
  BILLING_TYPE_LABEL,
  billingTypeValues,
  type BillingType,
} from '../schema';

type LineDraft = {
  rowId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
};

const initialState: UpdateInvoiceState = {};

export type InvoiceEditFormInitial = {
  id: string;
  number: string;
  projectId: string;
  projectLabel: string;
  customerLabel: string;
  status: string;
  billingType: BillingType;
  invoiceDate: string;
  dueDate: string;
  taxAmount: string;
  retainagePercent: string;
  retainageAmount: string;
  expectedRetainageReleaseDate: string;
  amountPaid: string;
  notes: string;
  termsOverride: string;
  lines: Array<{
    description: string;
    unit: string;
    quantity: string;
    unitCost: string;
  }>;
};

export function InvoiceEditForm({ initial }: { initial: InvoiceEditFormInitial }) {
  const [state, formAction, pending] = useActionState(
    updateInvoiceFullAction,
    initialState,
  );

  const [lines, setLines] = useState<LineDraft[]>(
    initial.lines.map((l) => ({
      rowId: crypto.randomUUID(),
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
    })),
  );
  const [billingType, setBillingType] = useState<BillingType>(initial.billingType);
  const [invoiceDate, setInvoiceDate] = useState(initial.invoiceDate);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [taxAmount, setTaxAmount] = useState(initial.taxAmount);
  const [retainagePercent, setRetainagePercent] = useState(initial.retainagePercent);
  const [retainageAmount, setRetainageAmount] = useState(initial.retainageAmount);
  const [retainageAmountManual, setRetainageAmountManual] = useState(false);
  const [expectedRetainageReleaseDate, setExpectedRetainageReleaseDate] = useState(
    initial.expectedRetainageReleaseDate,
  );
  const [notes, setNotes] = useState(initial.notes);
  const [termsOverride, setTermsOverride] = useState(initial.termsOverride);

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const l of lines) {
      subtotal = add(
        subtotal,
        multiply(Number(l.quantity) || 0, Number(l.unitCost) || 0),
      );
    }
    const tax = Number(taxAmount) || 0;
    const pct = Number(retainagePercent) || 0;
    const derivedHeld = pct > 0 ? (subtotal * pct) / 100 : 0;
    const retainage = retainageAmountManual
      ? Number(retainageAmount) || 0
      : Math.round(derivedHeld * 100) / 100;
    const total = subtract(add(subtotal, tax), retainage);
    const paid = Number(initial.amountPaid) || 0;
    const balance = subtract(total, paid);
    return { subtotal, tax, retainage, total, paid, balance, pct };
  }, [
    lines,
    taxAmount,
    retainagePercent,
    retainageAmount,
    retainageAmountManual,
    initial.amountPaid,
  ]);

  const retainageDisplay = retainageAmountManual
    ? retainageAmount
    : totals.retainage.toFixed(2);

  const linesPayload = lines.map((l) => ({
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
  }));

  const updateLine = (rowId: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));

  const newEmptyLine = (): LineDraft => ({
    rowId: crypto.randomUUID(),
    description: '',
    unit: '',
    quantity: '1',
    unitCost: '0',
  });

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="number" value={initial.number} />
      <input type="hidden" name="projectId" value={initial.projectId} />
      <input type="hidden" name="status" value={initial.status} />
      <input type="hidden" name="amountPaid" value={initial.amountPaid} />
      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
        Editing existing invoice. <strong>Customer</strong>, <strong>project</strong>,
        and <strong>invoice number</strong> are locked — to change those, void this
        invoice and create a new one. After saving, balance and status auto-derive
        from existing payments against the new total.
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Invoice header</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Invoice number (locked)">
            <Input value={initial.number} readOnly disabled />
          </Field>
          <Field label="Status (derived from payments)">
            <Input value={initial.status} readOnly disabled />
          </Field>
          <Field label="Billing type" error={err('billingType')}>
            <Select
              name="billingType"
              value={billingType}
              onChange={(e) => setBillingType(e.target.value as BillingType)}
            >
              {billingTypeValues.map((b) => (
                <option key={b} value={b}>
                  {BILLING_TYPE_LABEL[b]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project (locked)">
            <Input value={initial.projectLabel} readOnly disabled />
          </Field>
          <Field label="Customer (locked)">
            <Input value={initial.customerLabel} readOnly disabled />
          </Field>
          <Field label="Invoice date" error={err('invoiceDate')} required>
            <Input
              name="invoiceDate"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Due date" error={err('dueDate')}>
            <Input
              name="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Billing breakdown
        </legend>
        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 px-1 text-xs font-medium text-slate-500">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Unit cost</span>
            <span className="text-right">Line total</span>
            <span />
          </div>
          {lines.map((line) => {
            const lineTotal = multiply(
              Number(line.quantity) || 0,
              Number(line.unitCost) || 0,
            );
            return (
              <div
                key={line.rowId}
                className="grid grid-cols-1 md:grid-cols-[2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 items-start"
              >
                <Input
                  value={line.description}
                  onChange={(e) =>
                    updateLine(line.rowId, { description: e.target.value })
                  }
                  placeholder="Description"
                />
                <Input
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.rowId, { quantity: e.target.value })}
                />
                <Input
                  value={line.unit}
                  onChange={(e) => updateLine(line.rowId, { unit: e.target.value })}
                  placeholder="lot"
                />
                <Input
                  inputMode="decimal"
                  value={line.unitCost}
                  onChange={(e) => updateLine(line.rowId, { unitCost: e.target.value })}
                />
                <div className="flex items-center justify-end h-10 px-2 text-sm tabular-nums">
                  {formatMoney(lineTotal)}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLines((prev) => prev.filter((l) => l.rowId !== line.rowId))
                  }
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, newEmptyLine()])}
          >
            + Add line
          </Button>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Totals</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Tax / VAT" error={err('taxAmount')}>
            <Input
              name="taxAmount"
              inputMode="decimal"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
            />
          </Field>
          <Field label="Retainage %" error={err('retainagePercent')}>
            <Input
              name="retainagePercent"
              inputMode="decimal"
              value={retainagePercent}
              onChange={(e) => {
                setRetainagePercent(e.target.value);
                setRetainageAmountManual(false);
              }}
              placeholder="e.g. 10"
            />
          </Field>
          <Field
            label={
              retainageAmountManual
                ? 'Retainage held (manual)'
                : 'Retainage held (auto from %)'
            }
            error={err('retainageAmount')}
          >
            <Input
              name="retainageAmount"
              inputMode="decimal"
              value={retainageDisplay}
              onChange={(e) => {
                setRetainageAmount(e.target.value);
                setRetainageAmountManual(true);
              }}
            />
          </Field>
          <Field
            label="Expected retainage release date"
            error={err('expectedRetainageReleaseDate')}
          >
            <Input
              name="expectedRetainageReleaseDate"
              type="date"
              value={expectedRetainageReleaseDate}
              onChange={(e) => setExpectedRetainageReleaseDate(e.target.value)}
            />
          </Field>
          <Field label="Amount paid (from payments — read-only)">
            <Input value={initial.amountPaid} readOnly disabled />
          </Field>
        </div>
      </fieldset>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
        <Stat label="Subtotal" value={formatMoney(totals.subtotal)} />
        <Stat label="Tax / VAT" value={formatMoney(totals.tax)} />
        <Stat
          label={`Retainage held${totals.pct > 0 ? ` (${totals.pct.toFixed(2)}%)` : ''}`}
          value={formatMoney(totals.retainage)}
        />
        <Stat label="New total" value={formatMoney(totals.total)} />
        <Stat
          label="Balance after save"
          value={formatMoney(totals.balance)}
          valueClassName={
            totals.balance <= 0 ? 'text-emerald-700' : 'text-amber-700'
          }
        />
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Notes & terms</legend>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <textarea
            name="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Payment terms (override template)</Label>
          <textarea
            name="termsOverride"
            rows={3}
            value={termsOverride}
            onChange={(e) => setTermsOverride(e.target.value)}
            className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Link href={`/invoices/${initial.id}`}>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums ${
          valueClassName ?? 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
