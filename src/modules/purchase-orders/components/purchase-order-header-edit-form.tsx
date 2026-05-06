'use client';

// Header-only edit form for a PO. Vendor, project, line items, totals,
// and the receipt-driven status are NOT editable here — once a PO is
// issued, it represents committed cost that vendors and accounting see.
// Only available while the PO is in `draft` status.

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  updatePurchaseOrderHeaderAction,
  type UpdatePurchaseOrderHeaderState,
} from '../actions';

const initial: UpdatePurchaseOrderHeaderState = {};

export function PurchaseOrderHeaderEditForm({
  id,
  initial: values,
}: {
  id: string;
  initial: {
    issueDate: string;
    expectedDeliveryDate: string;
    shipToAddressLine1: string;
    shipToCity: string;
    shipToState: string;
    shipToPostalCode: string;
    notes: string;
  };
}) {
  const [state, formAction, pending] = useActionState(
    updatePurchaseOrderHeaderAction,
    initial,
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      <input type="hidden" name="id" value={id} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Issue date" error={err('issueDate')}>
          <Input name="issueDate" type="date" defaultValue={values.issueDate} />
        </Field>

        <Field label="Expected delivery" error={err('expectedDeliveryDate')}>
          <Input
            name="expectedDeliveryDate"
            type="date"
            defaultValue={values.expectedDeliveryDate}
          />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Ship-to address
        </legend>
        <Field label="Street" error={err('shipToAddressLine1')}>
          <Input
            name="shipToAddressLine1"
            defaultValue={values.shipToAddressLine1}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City" error={err('shipToCity')}>
            <Input name="shipToCity" defaultValue={values.shipToCity} />
          </Field>
          <Field label="State" error={err('shipToState')}>
            <Input name="shipToState" defaultValue={values.shipToState} />
          </Field>
          <Field label="Postal code" error={err('shipToPostalCode')}>
            <Input
              name="shipToPostalCode"
              defaultValue={values.shipToPostalCode}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          defaultValue={values.notes}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Link href={{ pathname: `/purchase-orders/${id}` }}>
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
