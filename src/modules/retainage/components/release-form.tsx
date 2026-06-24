'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import {
  createRetainageReleaseAction,
  type CreateRetainageReleaseState,
} from '../actions';

const initialState: CreateRetainageReleaseState = {};

export type RetainageInvoiceOption = {
  id: string;
  number: string;
  projectName: string;
  customerName: string;
  retainageAmount: string;
  retainageReleased: string;
  expectedReleaseDate: string | null;
  /** The original invoice's effective VAT rate (%), applied to the release. */
  vatRatePercent: number;
};

export type RetainagePaymentOption = {
  id: string;
  paymentNumber: string;
  paidDate: string;
  amount: string;
  invoiceId: string;
};

export function RetainageReleaseForm({
  invoices,
  payments,
  defaultReleaseNumber,
  defaultReleaseDate,
  defaultInvoiceId,
}: {
  invoices: RetainageInvoiceOption[];
  payments: RetainagePaymentOption[];
  defaultReleaseNumber: string;
  defaultReleaseDate: string;
  defaultInvoiceId?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createRetainageReleaseAction,
    initialState,
  );
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId ?? '');
  const [amount, setAmount] = useState('');

  const selectedInvoice = useMemo(
    () => invoices.find((i) => i.id === invoiceId),
    [invoices, invoiceId],
  );

  const heldBalance = selectedInvoice
    ? subtract(
        parseMoney(selectedInvoice.retainageAmount),
        parseMoney(selectedInvoice.retainageReleased),
      )
    : 0;

  const enteredAmount = Number(amount) || 0;
  const newBalance = selectedInvoice ? subtract(heldBalance, enteredAmount) : 0;
  // VAT on the released retention — payable now per the DIR retention rule.
  const vatRate = selectedInvoice ? selectedInvoice.vatRatePercent : 0;
  const vatOnRelease = Math.round(enteredAmount * vatRate) / 100;
  const totalWithVat = enteredAmount + vatOnRelease;

  const matchingPayments = useMemo(
    () => payments.filter((p) => p.invoiceId === invoiceId),
    [payments, invoiceId],
  );

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Release header
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Release number" error={err('releaseNumber')} required>
            <Input
              name="releaseNumber"
              defaultValue={defaultReleaseNumber}
              required
            />
          </Field>
          <Field label="Release date" error={err('releaseDate')} required>
            <Input
              name="releaseDate"
              type="date"
              defaultValue={defaultReleaseDate}
              required
            />
          </Field>
        </div>

        <Field label="Linked invoice" error={err('invoiceId')} required>
          <Select
            name="invoiceId"
            value={invoiceId}
            onChange={(e) => {
              setInvoiceId(e.target.value);
              const inv = invoices.find((i) => i.id === e.target.value);
              if (inv) {
                const bal = subtract(
                  parseMoney(inv.retainageAmount),
                  parseMoney(inv.retainageReleased),
                );
                setAmount(bal > 0 ? bal.toFixed(2) : '0');
              }
            }}
            required
          >
            <option value="" disabled>
              {invoices.length === 0
                ? 'No invoices with retainage held'
                : 'Select an invoice'}
            </option>
            {invoices.map((inv) => {
              const bal = subtract(
                parseMoney(inv.retainageAmount),
                parseMoney(inv.retainageReleased),
              );
              return (
                <option key={inv.id} value={inv.id}>
                  {inv.number} — {inv.projectName} ({inv.customerName}) ·{' '}
                  {formatMoney(bal)} held
                </option>
              );
            })}
          </Select>
        </Field>

        {selectedInvoice && (
          <Card className="bg-slate-50 border-slate-200">
            <CardContent className="p-3 text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Customer" value={selectedInvoice.customerName} />
              <Stat label="Project" value={selectedInvoice.projectName} />
              <Stat
                label="Retainage held"
                value={formatMoney(selectedInvoice.retainageAmount)}
              />
              <Stat
                label="Balance to release"
                value={formatMoney(heldBalance)}
                valueClassName={heldBalance > 0 ? 'text-amber-700' : 'text-emerald-700'}
              />
            </CardContent>
          </Card>
        )}
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Release amount & link
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Amount released" error={err('amount')} required>
            <Input
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>
          <Field
            label="Linked payment (optional)"
            error={err('paymentId')}
            className="md:col-span-2"
          >
            <Select name="paymentId" defaultValue="">
              <option value="">— None —</option>
              {matchingPayments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.paymentNumber} · {p.paidDate} · {formatMoney(p.amount)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      {selectedInvoice && enteredAmount > 0 && (
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <Stat label="Held before" value={formatMoney(heldBalance)} />
            <Stat
              label="This release"
              value={formatMoney(enteredAmount)}
              valueClassName="text-emerald-700"
            />
            <Stat
              label="Held after"
              value={formatMoney(newBalance)}
              valueClassName={
                newBalance <= 0
                  ? 'text-emerald-700'
                  : newBalance < heldBalance
                    ? 'text-amber-700'
                    : 'text-slate-900'
              }
            />
          </div>
          {vatRate > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <Stat
                label="Retention released (net)"
                value={formatMoney(enteredAmount)}
              />
              <Stat
                label={`VAT (${vatRate.toFixed(2)}%) — payable now`}
                value={formatMoney(vatOnRelease)}
                valueClassName="text-blue-800"
              />
              <Stat
                label="Total invoiced on release"
                value={formatMoney(totalWithVat)}
                valueClassName="font-semibold"
              />
            </div>
          )}
        </>
      )}

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Punch-list sign-off date, owner reference, partial-release reason, etc."
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Releasing…' : 'Release retainage'}
        </Button>
        <Link href="/retainage">
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
  className,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
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
        className={`mt-0.5 text-base font-medium tabular-nums ${
          valueClassName ?? 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
