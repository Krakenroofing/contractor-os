'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  updateCompanySettingsAction,
  type CompanySettingsState,
} from '../actions';
import type { Company } from '@/db/schema';

const initialState: CompanySettingsState = {};

export function CompanySettingsForm({ company }: { company: Company }) {
  const [state, formAction, pending] = useActionState(
    updateCompanySettingsAction,
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
      {state.ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          Saved.
        </div>
      )}

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Company profile</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Company name" error={err('name')} required>
            <Input name="name" defaultValue={company.name} required />
          </Field>
          <Field label="License number" error={err('licenseNumber')}>
            <Input name="licenseNumber" defaultValue={company.licenseNumber ?? ''} />
          </Field>
          <Field label="Email" error={err('email')}>
            <Input name="email" type="email" defaultValue={company.email ?? ''} />
          </Field>
          <Field label="Phone" error={err('phone')}>
            <Input name="phone" defaultValue={company.phone ?? ''} />
          </Field>
          <Field label="Website" error={err('website')} className="md:col-span-2">
            <Input name="website" defaultValue={company.website ?? ''} />
          </Field>
        </div>

      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Address</legend>
        <Field label="Street" error={err('addressLine1')}>
          <Input name="addressLine1" defaultValue={company.addressLine1 ?? ''} />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City" error={err('city')}>
            <Input name="city" defaultValue={company.city ?? ''} />
          </Field>
          <Field label="State / parish" error={err('state')}>
            <Input name="state" defaultValue={company.state ?? ''} />
          </Field>
          <Field label="Postal code" error={err('postalCode')}>
            <Input name="postalCode" defaultValue={company.postalCode ?? ''} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Financial defaults
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Currency" error={err('defaultCurrency')} required>
            <Input
              name="defaultCurrency"
              defaultValue={company.defaultCurrency}
              maxLength={10}
              required
            />
          </Field>
          <Field label="Default markup %" error={err('defaultMarkupPercent')} required>
            <Input
              name="defaultMarkupPercent"
              inputMode="decimal"
              defaultValue={company.defaultMarkupPercent}
              required
            />
          </Field>
          <Field label="Tax rate %" error={err('taxRatePercent')}>
            <Input
              name="taxRatePercent"
              inputMode="decimal"
              defaultValue={company.taxRatePercent}
            />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          VAT (on/off + rate) now lives under{' '}
          <span className="font-medium text-slate-700">
            Settings → Accounting
          </span>
          .
        </p>
        <Field
          label="Proposal validity (days)"
          error={err('proposalValidityDays')}
          required
        >
          <Input
            name="proposalValidityDays"
            type="number"
            min="0"
            step="1"
            defaultValue={String(company.proposalValidityDays)}
            required
          />
        </Field>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Banking & TIN
        </legend>
        <p className="text-xs text-slate-500">
          These fields populate the wire-instructions block on invoices when an
          invoice template has that section enabled.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Tax ID (TIN)" error={err('tinNumber')}>
            <Input name="tinNumber" defaultValue={company.tinNumber ?? ''} />
          </Field>
          <Field label="Bank name" error={err('bankName')}>
            <Input name="bankName" defaultValue={company.bankName ?? ''} />
          </Field>
          <Field label="Branch (Bahamas banks)" error={err('bankBranch')}>
            <Input name="bankBranch" defaultValue={company.bankBranch ?? ''} />
          </Field>
          <Field label="Routing number — ACH (US banks)" error={err('bankRoutingNumber')}>
            <Input
              name="bankRoutingNumber"
              defaultValue={company.bankRoutingNumber ?? ''}
            />
          </Field>
          <Field label="Account name / Beneficiary" error={err('bankAccountName')}>
            <Input
              name="bankAccountName"
              defaultValue={company.bankAccountName ?? ''}
            />
          </Field>
          <Field label="Account number" error={err('bankAccountNumber')}>
            <Input
              name="bankAccountNumber"
              defaultValue={company.bankAccountNumber ?? ''}
            />
          </Field>
          <Field label="Bank address" error={err('bankAddress')}>
            <Input
              name="bankAddress"
              defaultValue={company.bankAddress ?? ''}
            />
          </Field>
        </div>
        <Field label="Additional payment notes" error={err('paymentNotes')}>
          <textarea
            name="paymentNotes"
            rows={3}
            defaultValue={company.paymentNotes ?? ''}
            className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Wire transfers may take 1-2 business days. Reference invoice number on payment."
          />
        </Field>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Standard document language
        </legend>
        <Field label="Standard payment terms" error={err('standardPaymentTerms')}>
          <textarea
            name="standardPaymentTerms"
            rows={5}
            defaultValue={company.standardPaymentTerms ?? ''}
            className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="30% deposit on signing, 50% on material delivery, 20% on completion."
          />
        </Field>
        <Field label="Standard warranty language" error={err('standardWarrantyLanguage')}>
          <textarea
            name="standardWarrantyLanguage"
            rows={5}
            defaultValue={company.standardWarrantyLanguage ?? ''}
            className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="10-year workmanship warranty. Manufacturer materials warranty per certificate."
          />
        </Field>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
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
