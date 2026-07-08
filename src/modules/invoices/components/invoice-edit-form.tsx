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
import {
  ProductPicker,
  type ProductPickerOption,
} from '@/modules/inventory/components/product-picker';

type LineDraft = {
  rowId: string;
  inventoryItemId: string;
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
  /** UUID of the linked change order, or '' for base contract. */
  changeOrderId: string;
  invoiceDate: string;
  dueDate: string;
  taxAmount: string;
  retainagePercent: string;
  retainageAmount: string;
  expectedRetainageReleaseDate: string;
  amountPaid: string;
  notes: string;
  termsOverride: string;
  purchaseOrderNumber: string;
  billingLabel: string;
  lines: Array<{
    inventoryItemId: string | null;
    description: string;
    unit: string;
    quantity: string;
    unitCost: string;
  }>;
};

export type InvoiceEditFormChangeOrderOption = {
  id: string;
  label: string;
};

export function InvoiceEditForm({
  initial,
  changeOrderOptions,
  products = [],
  showVat = true,
  companyVatRatePercent = 0,
}: {
  initial: InvoiceEditFormInitial;
  changeOrderOptions: InvoiceEditFormChangeOrderOption[];
  products?: ProductPickerOption[];
  /** Hide the Tax/VAT field + totals line for non-VAT companies. */
  showVat?: boolean;
  /** Company VAT rate (numeric percent). When > 0, the Tax/VAT field
   *  auto-recomputes to (subtotal − retainage) × rate as lines change, so
   *  editing the total also updates the VAT — unless the operator overrides
   *  it by typing in the field. */
  companyVatRatePercent?: number;
}) {
  const [state, formAction, pending] = useActionState(
    updateInvoiceFullAction,
    initialState,
  );

  const [lines, setLines] = useState<LineDraft[]>(
    initial.lines.map((l) => ({
      rowId: crypto.randomUUID(),
      inventoryItemId: l.inventoryItemId ?? '',
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
    })),
  );
  const [number, setNumber] = useState(initial.number);
  const [billingType, setBillingType] = useState<BillingType>(initial.billingType);
  const [changeOrderId, setChangeOrderId] = useState(initial.changeOrderId);
  const [invoiceDate, setInvoiceDate] = useState(initial.invoiceDate);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [taxAmount, setTaxAmount] = useState(initial.taxAmount);
  // Start in auto mode (VAT follows the subtotal) only when the company has a
  // VAT rate AND the stored VAT already equals (subtotal − retainage) × rate —
  // i.e. it was the standard auto figure. If a non-standard VAT was entered by
  // hand, preserve it (start manual) until the operator resets to auto.
  const [taxAmountManual, setTaxAmountManual] = useState(() => {
    if (companyVatRatePercent <= 0) return true;
    let sub = 0;
    for (const l of initial.lines) {
      sub = add(sub, multiply(Number(l.quantity) || 0, Number(l.unitCost) || 0));
    }
    const ret = Number(initial.retainageAmount) || 0;
    const auto = Math.round(((sub - ret) * companyVatRatePercent) / 100 * 100) / 100;
    return Math.abs((Number(initial.taxAmount) || 0) - auto) > 0.005;
  });
  const [retainagePercent, setRetainagePercent] = useState(initial.retainagePercent);
  const [retainageAmount, setRetainageAmount] = useState(initial.retainageAmount);
  const [retainageAmountManual, setRetainageAmountManual] = useState(false);
  const [expectedRetainageReleaseDate, setExpectedRetainageReleaseDate] = useState(
    initial.expectedRetainageReleaseDate,
  );
  const [notes, setNotes] = useState(initial.notes);
  const [termsOverride, setTermsOverride] = useState(initial.termsOverride);
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(
    initial.purchaseOrderNumber,
  );
  const [billingLabel, setBillingLabel] = useState(initial.billingLabel);

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const l of lines) {
      subtotal = add(
        subtotal,
        multiply(Number(l.quantity) || 0, Number(l.unitCost) || 0),
      );
    }
    const pct = Number(retainagePercent) || 0;
    const derivedHeld = pct > 0 ? (subtotal * pct) / 100 : 0;
    const retainage = retainageAmountManual
      ? Number(retainageAmount) || 0
      : Math.round(derivedHeld * 100) / 100;
    // VAT applies to the post-retainage base (retainage is deferred billing,
    // so its VAT defers too) — mirrors the create form. Auto-recomputes as
    // lines change unless the operator has typed in the Tax field.
    const netOfRetainage = subtract(subtotal, retainage);
    const autoTax =
      companyVatRatePercent > 0
        ? Math.round(((netOfRetainage * companyVatRatePercent) / 100) * 100) / 100
        : 0;
    const tax = taxAmountManual ? Number(taxAmount) || 0 : autoTax;
    const total = add(netOfRetainage, tax);
    const paid = Number(initial.amountPaid) || 0;
    const balance = subtract(total, paid);
    return { subtotal, tax, retainage, total, paid, balance, pct };
  }, [
    lines,
    taxAmount,
    taxAmountManual,
    companyVatRatePercent,
    retainagePercent,
    retainageAmount,
    retainageAmountManual,
    initial.amountPaid,
  ]);

  const retainageDisplay = retainageAmountManual
    ? retainageAmount
    : totals.retainage.toFixed(2);
  // In auto mode show the derived VAT so the operator sees it follow the total.
  const taxDisplay = taxAmountManual ? taxAmount : totals.tax.toFixed(2);

  // Guard: flag when the entered VAT doesn't match the company rate ×
  // (subtotal − retainage) — e.g. a manual figure that went stale after the
  // lines changed — so it's caught before the invoice is sent. In auto mode
  // taxDisplay equals the expected figure, so this never fires there.
  const vatBase = subtract(totals.subtotal, totals.retainage);
  const expectedVat =
    companyVatRatePercent > 0
      ? Math.round((vatBase * companyVatRatePercent) / 100 * 100) / 100
      : 0;
  const enteredVat = Number(taxDisplay) || 0;
  const vatMismatch =
    showVat &&
    companyVatRatePercent > 0 &&
    Math.abs(enteredVat - expectedVat) > 0.01;
  const effectiveVatPct = vatBase > 0 ? (enteredVat / vatBase) * 100 : 0;

  const linesPayload = lines.map((l) => ({
    inventoryItemId: l.inventoryItemId,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
  }));

  const updateLine = (rowId: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));

  const newEmptyLine = (): LineDraft => ({
    rowId: crypto.randomUUID(),
    inventoryItemId: '',
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
      <input type="hidden" name="projectId" value={initial.projectId} />
      <input type="hidden" name="status" value={initial.status} />
      <input type="hidden" name="amountPaid" value={initial.amountPaid} />
      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
        Editing existing invoice. <strong>Customer</strong> and{' '}
        <strong>project</strong> are locked — to move this invoice, void it and
        create a new one. The invoice number can be changed (it must stay unique).
        After saving, balance and status auto-derive from existing payments
        against the new total.
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Invoice header</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Invoice number" error={err('number')} required>
            <Input
              name="number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
            />
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
          <Field label="PO number" error={err('purchaseOrderNumber')}>
            <Input
              name="purchaseOrderNumber"
              value={purchaseOrderNumber}
              onChange={(e) => setPurchaseOrderNumber(e.target.value)}
              placeholder="e.g. PO-2026-0042"
            />
          </Field>
          <Field label="Billing #" error={err('billingLabel')}>
            <Input
              name="billingLabel"
              value={billingLabel}
              onChange={(e) => setBillingLabel(e.target.value)}
              placeholder="e.g. Billing 3 of 12"
            />
          </Field>
          <Field
            label="Bills against (change order)"
            error={err('changeOrderId')}
          >
            <Select
              name="changeOrderId"
              value={changeOrderId}
              onChange={(e) => setChangeOrderId(e.target.value)}
            >
              <option value="">Base contract</option>
              {changeOrderOptions.map((co) => (
                <option key={co.id} value={co.id}>
                  {co.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500 mt-1">
              Reclassifies this invoice for reporting. Doesn&apos;t change the
              money on the invoice — just which contract bucket it rolls up
              under.
            </p>
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Billing breakdown
        </legend>
        <p className="text-xs text-slate-500">
          To credit an amount off this bill (a deposit already paid, a
          reimbursement, a discount), add a line with a{' '}
          <span className="font-medium">negative unit cost</span>. It reduces the
          taxable subtotal, so VAT is charged only on the net.
        </p>
        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[1.6fr_2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 px-1 text-xs font-medium text-slate-500">
            <span>Product</span>
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
                className="grid grid-cols-1 md:grid-cols-[1.6fr_2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 items-start"
              >
                <ProductPicker
                  value={line.inventoryItemId}
                  options={products}
                  onItemSelected={(picked) => {
                    if (!picked) {
                      updateLine(line.rowId, { inventoryItemId: '' });
                      return;
                    }
                    updateLine(line.rowId, {
                      inventoryItemId: picked.id,
                      description:
                        line.description.trim() === '' ? picked.name : line.description,
                      unit:
                        line.unit.trim() === '' && picked.unit
                          ? picked.unit
                          : line.unit,
                      unitCost:
                        (Number(line.unitCost) || 0) === 0 && picked.defaultCost > 0
                          ? picked.defaultCost.toString()
                          : line.unitCost,
                    });
                  }}
                />
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, newEmptyLine()])}
          >
            + Add line
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                { ...newEmptyLine(), description: 'Less ' },
              ])
            }
          >
            + Add credit / deduction
          </Button>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Totals</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {showVat ? (
            <Field
              label={
                companyVatRatePercent > 0
                  ? `Tax / VAT (${companyVatRatePercent.toFixed(2)}% auto)`
                  : 'Tax / VAT'
              }
              error={err('taxAmount')}
            >
              <Input
                name="taxAmount"
                inputMode="decimal"
                value={taxDisplay}
                onChange={(e) => {
                  setTaxAmount(e.target.value);
                  setTaxAmountManual(true);
                }}
              />
              {companyVatRatePercent > 0 && taxAmountManual && (
                <button
                  type="button"
                  onClick={() => {
                    setTaxAmountManual(false);
                    setTaxAmount('0');
                  }}
                  className="mt-1 text-[11px] text-slate-500 hover:text-slate-900 underline"
                >
                  Reset to auto ({companyVatRatePercent.toFixed(2)}% of subtotal)
                </button>
              )}
              {vatMismatch && (
                <p className="mt-1 text-[11px] text-amber-700">
                  ⚠ This VAT is {effectiveVatPct.toFixed(2)}% of the base, not{' '}
                  {companyVatRatePercent.toFixed(2)}% — expected{' '}
                  {expectedVat.toFixed(2)}. Adjust it or use &ldquo;Reset to
                  auto&rdquo;.
                </p>
              )}
            </Field>
          ) : (
            <input type="hidden" name="taxAmount" value={taxDisplay} />
          )}
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
        {showVat && <Stat label="Tax / VAT" value={formatMoney(totals.tax)} />}
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
