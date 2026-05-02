'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { backfillPaymentAction, type BackfillState } from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export type PaymentInvoiceOption = {
  id: string;
  label: string;
};

export function PaymentMiniForm({
  invoices,
}: {
  invoices: PaymentInvoiceOption[];
}) {
  const [state, formAction, pending] = useActionState(backfillPaymentAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Record payment">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Invoice" error={err('invoiceId')} required className="md:col-span-2">
            <Select name="invoiceId" required defaultValue="">
              <option value="" disabled>
                {invoices.length === 0
                  ? 'No invoices yet — finish step 5 first'
                  : 'Pick an invoice'}
              </option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment number" error={err('paymentNumber')} required>
            <Input
              name="paymentNumber"
              required
              maxLength={50}
              placeholder="PAY-2026-001"
            />
          </Field>
          <Field label="Paid date (historical)" error={err('paidDate')} required>
            <Input name="paidDate" type="date" required />
          </Field>
          <Field label="Amount" error={err('amount')} required>
            <Input
              name="amount"
              inputMode="decimal"
              required
              placeholder="0.00"
            />
          </Field>
          <Field label="Method" error={err('method')}>
            <Select name="method" defaultValue="ach">
              <option value="ach">ACH</option>
              <option value="wire">Wire</option>
              <option value="check">Check</option>
              <option value="credit_card">Credit card</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="applied">
              <option value="pending">Pending</option>
              <option value="received">Received</option>
              <option value="applied">Applied</option>
              <option value="returned">Returned</option>
            </Select>
          </Field>
          <Field label="Reference" error={err('reference')}>
            <Input name="reference" maxLength={100} placeholder="Check #, wire ID…" />
          </Field>
          <Field label="Bank account" error={err('bankAccount')} className="md:col-span-2">
            <Input
              name="bankAccount"
              maxLength={100}
              placeholder="e.g. Operating — Wells Fargo ••4218"
            />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
