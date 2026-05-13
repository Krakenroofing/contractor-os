'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createCustomerAction,
  updateCustomerAction,
  type CreateCustomerState,
  type UpdateCustomerState,
} from '../actions';
import { customerTypeValues, type CustomerType } from '../schema';

export type CustomerFormInitialValues = {
  id?: string;
  name: string;
  customerType: CustomerType;
  primaryContactName: string;
  email: string;
  phone: string;
  billingAddressLine1: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  tinNumber: string;
  notes: string;
};

const blankInitial: CustomerFormInitialValues = {
  name: '',
  customerType: 'residential',
  primaryContactName: '',
  email: '',
  phone: '',
  billingAddressLine1: '',
  billingCity: '',
  billingState: '',
  billingPostalCode: '',
  tinNumber: '',
  notes: '',
};

const typeLabel: Record<(typeof customerTypeValues)[number], string> = {
  residential: 'Residential',
  commercial: 'Commercial',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

export function CustomerForm({
  mode = { kind: 'create' },
  initial,
}: {
  mode?: Mode;
  initial?: CustomerFormInitialValues;
}) {
  const values = initial ?? blankInitial;
  const isEdit = mode.kind === 'edit';

  // useActionState's state shape is identical across create/edit (both use
  // { errors?, formError? }), so we can branch on action without splitting
  // the component into two near-duplicates.
  const initialState: CreateCustomerState | UpdateCustomerState = {};
  const [state, formAction, pending] = useActionState(
    isEdit ? updateCustomerAction : createCustomerAction,
    initialState,
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {isEdit && <input type="hidden" name="id" value={mode.id} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Company name"
          error={err('name')}
          className="md:col-span-2"
          required
        >
          <Input
            name="name"
            placeholder="Acme Property Management"
            required
            defaultValue={values.name}
          />
        </Field>

        <Field label="Type" error={err('customerType')}>
          <Select name="customerType" defaultValue={values.customerType}>
            {customerTypeValues.map((t) => (
              <option key={t} value={t}>
                {typeLabel[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Primary contact" error={err('primaryContactName')}>
          <Input
            name="primaryContactName"
            placeholder="Jane Smith"
            defaultValue={values.primaryContactName}
          />
        </Field>

        <Field label="Email" error={err('email')}>
          <Input
            name="email"
            type="email"
            placeholder="jane@example.com"
            defaultValue={values.email}
          />
        </Field>

        <Field label="Phone" error={err('phone')}>
          <Input
            name="phone"
            placeholder="(303) 555-0188"
            defaultValue={values.phone}
          />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Billing address</legend>
        <Field label="Street" error={err('billingAddressLine1')}>
          <Input
            name="billingAddressLine1"
            defaultValue={values.billingAddressLine1}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City" error={err('billingCity')}>
            <Input name="billingCity" defaultValue={values.billingCity} />
          </Field>
          <Field label="State" error={err('billingState')}>
            <Input name="billingState" defaultValue={values.billingState} />
          </Field>
          <Field label="Postal code" error={err('billingPostalCode')}>
            <Input
              name="billingPostalCode"
              defaultValue={values.billingPostalCode}
            />
          </Field>
        </div>
        <Field label="Tax ID (TIN)" error={err('tinNumber')}>
          <Input
            name="tinNumber"
            defaultValue={values.tinNumber}
            placeholder="Customer&apos;s tax identification number"
          />
        </Field>
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
          {pending
            ? isEdit
              ? 'Saving…'
              : 'Creating…'
            : isEdit
              ? 'Save changes'
              : 'Create customer'}
        </Button>
        <Link href={isEdit ? `/customers/${mode.id}` : '/customers'}>
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
