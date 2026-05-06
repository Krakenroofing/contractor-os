'use client';

// Header-only edit form for an invoice. Line items, totals, retainage
// amounts, and the payment-driven status are NOT editable here — those
// flow through the existing payment / status / recreate paths. Only
// available while the invoice is in `draft` status.

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  updateInvoiceHeaderAction,
  type UpdateInvoiceHeaderState,
} from '../actions';
import {
  BILLING_TYPE_LABEL,
  billingTypeValues,
  type BillingType,
} from '../schema';

const initial: UpdateInvoiceHeaderState = {};

export function InvoiceHeaderEditForm({
  id,
  initial: values,
}: {
  id: string;
  initial: {
    invoiceDate: string;
    dueDate: string;
    billingType: BillingType;
    expectedRetainageReleaseDate: string;
    notes: string;
    termsOverride: string;
  };
}) {
  const [state, formAction, pending] = useActionState(
    updateInvoiceHeaderAction,
    initial,
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-4">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      <input type="hidden" name="id" value={id} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Invoice date" error={err('invoiceDate')} required>
          <Input
            name="invoiceDate"
            type="date"
            required
            defaultValue={values.invoiceDate}
          />
        </Field>

        <Field label="Due date" error={err('dueDate')}>
          <Input name="dueDate" type="date" defaultValue={values.dueDate} />
        </Field>

        <Field label="Billing type" error={err('billingType')}>
          <Select name="billingType" defaultValue={values.billingType}>
            {billingTypeValues.map((t) => (
              <option key={t} value={t}>
                {BILLING_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Expected retainage release"
          error={err('expectedRetainageReleaseDate')}
        >
          <Input
            name="expectedRetainageReleaseDate"
            type="date"
            defaultValue={values.expectedRetainageReleaseDate}
          />
        </Field>
      </div>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          defaultValue={values.notes}
        />
      </Field>

      <Field label="Terms override" error={err('termsOverride')}>
        <textarea
          name="termsOverride"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Leave blank to use the company default terms."
          defaultValue={values.termsOverride}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Link href={{ pathname: `/invoices/${id}` }}>
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
