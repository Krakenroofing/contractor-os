'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';
import {
  createVendorAction,
  updateVendorAction,
  type CreateVendorState,
  type UpdateVendorState,
} from '../actions';
import {
  TYPE_LABEL,
  vendorCostTypeValues,
  vendorTypeValues,
  type VendorType,
} from '../schema';

type Option = { id: string; label: string };

const COST_TYPE_LABEL: Record<(typeof vendorCostTypeValues)[number], string> = {
  labor: 'Labor',
  labor_burden: 'Labor burden',
  materials: 'Materials',
  subcontractor: 'Subcontractor',
  equipment_rental: 'Equipment rental',
  owned_equipment: 'Owned equipment',
  freight: 'Freight',
  customs_duty: 'Customs duty',
  vat: 'VAT',
  tools_consumables: 'Tools / consumables',
  fuel_travel: 'Fuel / travel',
  per_diem_housing: 'Per diem / housing',
  permits_fees: 'Permits / fees',
  disposal: 'Disposal',
  general_conditions: 'General conditions',
  change_order_work: 'Change order work',
  other: 'Other',
};

export type VendorFormInitialValues = {
  id?: string;
  name: string;
  vendorType: VendorType;
  primaryContactName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  defaultTerms: string;
  notes: string;
  defaultCostCodeId: string;
  defaultCostType: string;
  defaultAccountingAccountId: string;
};

const blankInitial: VendorFormInitialValues = {
  name: '',
  vendorType: 'supplier',
  primaryContactName: '',
  email: '',
  phone: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  defaultTerms: '',
  notes: '',
  defaultCostCodeId: '',
  defaultCostType: '',
  defaultAccountingAccountId: '',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

export function VendorForm({
  mode = { kind: 'create' },
  initial,
  costCodes = [],
  accountingAccounts = [],
}: {
  mode?: Mode;
  initial?: VendorFormInitialValues;
  costCodes?: Option[];
  accountingAccounts?: AccountingAccountOption[];
}) {
  const values = initial ?? blankInitial;
  const isEdit = mode.kind === 'edit';

  const initialState: CreateVendorState | UpdateVendorState = {};
  const [state, formAction, pending] = useActionState(
    isEdit ? updateVendorAction : createVendorAction,
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
            placeholder="ABC Roofing Supply"
            required
            defaultValue={values.name}
          />
        </Field>

        <Field label="Vendor type" error={err('vendorType')}>
          <Select name="vendorType" defaultValue={values.vendorType}>
            {vendorTypeValues.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Payment terms" error={err('defaultTerms')}>
          <Input
            name="defaultTerms"
            placeholder="Net 30"
            defaultValue={values.defaultTerms}
          />
        </Field>

        <Field label="Primary contact" error={err('primaryContactName')}>
          <Input
            name="primaryContactName"
            placeholder="Greg Patterson"
            defaultValue={values.primaryContactName}
          />
        </Field>

        <Field label="Email" error={err('email')}>
          <Input
            name="email"
            type="email"
            placeholder="orders@vendor.example"
            defaultValue={values.email}
          />
        </Field>

        <Field label="Phone" error={err('phone')}>
          <Input
            name="phone"
            placeholder="(303) 555-0301"
            defaultValue={values.phone}
          />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Address</legend>
        <Field label="Street" error={err('addressLine1')}>
          <Input name="addressLine1" defaultValue={values.addressLine1} />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City" error={err('city')}>
            <Input name="city" defaultValue={values.city} />
          </Field>
          <Field label="State" error={err('state')}>
            <Input name="state" defaultValue={values.state} />
          </Field>
          <Field label="Postal code" error={err('postalCode')}>
            <Input name="postalCode" defaultValue={values.postalCode} />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Insurance certificates, scheduling rules, etc."
          defaultValue={values.notes}
        />
      </Field>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Defaults for receipts
        </legend>
        <p className="text-xs text-slate-500">
          When this vendor is selected on a Receipt, blank fields auto-fill from
          these defaults. Existing operator picks are never overwritten.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Default cost code" error={err('defaultCostCodeId')}>
            <Select
              name="defaultCostCodeId"
              defaultValue={values.defaultCostCodeId}
            >
              <option value="">— none —</option>
              {costCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default cost type" error={err('defaultCostType')}>
            <Select
              name="defaultCostType"
              defaultValue={values.defaultCostType}
            >
              <option value="">— none —</option>
              {vendorCostTypeValues.map((c) => (
                <option key={c} value={c}>
                  {COST_TYPE_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Default accounting category"
            error={err('defaultAccountingAccountId')}
          >
            <VendorAccountingPickerField
              initial={values.defaultAccountingAccountId}
              accounts={accountingAccounts}
            />
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? isEdit
              ? 'Saving…'
              : 'Creating…'
            : isEdit
              ? 'Save changes'
              : 'Create vendor'}
        </Button>
        <Link href={isEdit ? `/vendors/${mode.id}` : '/vendors'}>
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

// Small wrapper so the grouped picker can be a controlled component and
// still submit via the existing form action (hidden mirror of value).
function VendorAccountingPickerField({
  initial,
  accounts,
}: {
  initial: string;
  accounts: AccountingAccountOption[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <AccountingAccountPicker
      name="defaultAccountingAccountId"
      value={value}
      onChange={setValue}
      accounts={accounts}
      placeholder="— none —"
    />
  );
}
