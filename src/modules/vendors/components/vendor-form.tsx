'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createVendorAction, type CreateVendorState } from '../actions';
import { TYPE_LABEL, vendorTypeValues } from '../schema';

const initialState: CreateVendorState = {};

export function VendorForm() {
  const [state, formAction, pending] = useActionState(createVendorAction, initialState);
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Company name"
          error={err('name')}
          className="md:col-span-2"
          required
        >
          <Input name="name" placeholder="ABC Roofing Supply" required />
        </Field>

        <Field label="Vendor type" error={err('vendorType')}>
          <Select name="vendorType" defaultValue="supplier">
            {vendorTypeValues.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Payment terms" error={err('defaultTerms')}>
          <Input name="defaultTerms" placeholder="Net 30" />
        </Field>

        <Field label="Primary contact" error={err('primaryContactName')}>
          <Input name="primaryContactName" placeholder="Greg Patterson" />
        </Field>

        <Field label="Email" error={err('email')}>
          <Input name="email" type="email" placeholder="orders@vendor.example" />
        </Field>

        <Field label="Phone" error={err('phone')}>
          <Input name="phone" placeholder="(303) 555-0301" />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Address</legend>
        <Field label="Street" error={err('addressLine1')}>
          <Input name="addressLine1" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City" error={err('city')}>
            <Input name="city" />
          </Field>
          <Field label="State" error={err('state')}>
            <Input name="state" />
          </Field>
          <Field label="Postal code" error={err('postalCode')}>
            <Input name="postalCode" />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Insurance certificates, scheduling rules, etc."
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create vendor'}
        </Button>
        <Link href="/vendors">
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
