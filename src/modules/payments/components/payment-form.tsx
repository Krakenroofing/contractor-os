'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import { createPaymentAction, type CreatePaymentState } from '../actions';
import {
  METHOD_LABEL,
  STATUS_LABEL,
  paymentMethodValues,
  paymentStatusValues,
} from '../schema';

const initialState: CreatePaymentState = {};

export type PaymentInvoiceOption = {
  id: string;
  number: string;
  projectName: string;
  customerName: string;
  total: string;
  amountPaid: string;
};

export function PaymentForm({
  invoices,
  defaultPaymentNumber,
  defaultPaidDate,
}: {
  invoices: PaymentInvoiceOption[];
  defaultPaymentNumber: string;
  defaultPaidDate: string;
}) {
  const [state, formAction, pending] = useActionState(createPaymentAction, initialState);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');

  const selectedInvoice = useMemo(
    () => invoices.find((i) => i.id === invoiceId),
    [invoices, invoiceId],
  );

  const balanceDue = selectedInvoice
    ? subtract(parseMoney(selectedInvoice.total), parseMoney(selectedInvoice.amountPaid))
    : 0;

  const enteredAmount = Number(amount) || 0;
  const newBalance = selectedInvoice ? subtract(balanceDue, enteredAmount) : 0;

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
          Payment header
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Payment number" error={err('paymentNumber')} required>
            <Input
              name="paymentNumber"
              defaultValue={defaultPaymentNumber}
              required
            />
          </Field>
          <Field label="Payment date" error={err('paidDate')} required>
            <Input name="paidDate" type="date" defaultValue={defaultPaidDate} required />
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="received">
              {paymentStatusValues.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
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
                const bal = subtract(parseMoney(inv.total), parseMoney(inv.amountPaid));
                setAmount(bal > 0 ? bal.toFixed(2) : '0');
              }
            }}
            required
          >
            <option value="" disabled>
              {invoices.length === 0
                ? 'No invoices in this company'
                : 'Select an invoice'}
            </option>
            {invoices.map((inv) => {
              const bal = subtract(parseMoney(inv.total), parseMoney(inv.amountPaid));
              return (
                <option key={inv.id} value={inv.id}>
                  {inv.number} — {inv.projectName} ({inv.customerName}) ·{' '}
                  {formatMoney(bal)} due
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
                label="Invoice total"
                value={formatMoney(selectedInvoice.total)}
              />
              <Stat
                label="Balance due"
                value={formatMoney(balanceDue)}
                valueClassName={balanceDue > 0 ? 'text-amber-700' : 'text-emerald-700'}
              />
            </CardContent>
          </Card>
        )}
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Method & receipt
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Amount received" error={err('amount')} required>
            <Input
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>
          <Field label="Method" error={err('method')} required>
            <Select name="method" defaultValue="ach">
              {paymentMethodValues.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference / check #" error={err('reference')}>
            <Input name="reference" placeholder="WT-44218 / #1042 / ACH-9911" />
          </Field>
          <Field
            label="Bank / account received into"
            error={err('bankAccount')}
            className="md:col-span-2"
          >
            <Input
              name="bankAccount"
              placeholder="e.g. Operating — Wells Fargo ••4218"
            />
          </Field>
        </div>
      </fieldset>

      {selectedInvoice && enteredAmount > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Stat label="Balance before" value={formatMoney(balanceDue)} />
          <Stat
            label="This payment"
            value={formatMoney(enteredAmount)}
            valueClassName="text-emerald-700"
          />
          <Stat
            label="Balance after"
            value={formatMoney(newBalance)}
            valueClassName={
              newBalance <= 0
                ? 'text-emerald-700'
                : newBalance < balanceDue
                  ? 'text-amber-700'
                  : 'text-slate-900'
            }
          />
        </div>
      )}

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Internal notes — bank batch, deposit slip number, customer note, etc."
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record payment'}
        </Button>
        <Link href="/payments">
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
