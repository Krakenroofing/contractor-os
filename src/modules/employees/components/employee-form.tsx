'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createEmployeeAction,
  updateEmployeeAction,
  type CreateEmployeeState,
  type UpdateEmployeeState,
} from '../actions';
import {
  EMPLOYMENT_TYPE_LABEL,
  PAY_RATE_BASIS_LABEL,
  PAY_RATE_HINT,
  employmentTypeValues,
  type EmploymentType,
} from '../schema';

export type EmployeeFormInitialValues = {
  id?: string;
  firstName: string;
  lastName: string;
  nibNumber: string;
  email: string;
  phone: string;
  employmentType: EmploymentType;
  payRate: string;
  hireDate: string;
  terminationDate: string;
  active: boolean;
  nibExempt: boolean;
  notes: string;
};

const blankInitial: EmployeeFormInitialValues = {
  firstName: '',
  lastName: '',
  nibNumber: '',
  email: '',
  phone: '',
  employmentType: 'hourly',
  payRate: '',
  hireDate: '',
  terminationDate: '',
  active: true,
  nibExempt: false,
  notes: '',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

export function EmployeeForm({
  mode = { kind: 'create' },
  initial,
}: {
  mode?: Mode;
  initial?: EmployeeFormInitialValues;
}) {
  const values = initial ?? blankInitial;
  const isEdit = mode.kind === 'edit';

  const initialState: CreateEmployeeState | UpdateEmployeeState = {};
  const [state, formAction, pending] = useActionState(
    isEdit ? updateEmployeeAction : createEmployeeAction,
    initialState,
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  // Track employment type live so the pay-rate label + hint update as the
  // user changes the dropdown.
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    values.employmentType,
  );
  const [nibExempt, setNibExempt] = useState<boolean>(values.nibExempt);

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {isEdit && <input type="hidden" name="id" value={mode.id} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="First name" error={err('firstName')} required>
          <Input
            name="firstName"
            required
            defaultValue={values.firstName}
            placeholder="John"
          />
        </Field>

        <Field label="Last name" error={err('lastName')} required>
          <Input
            name="lastName"
            required
            defaultValue={values.lastName}
            placeholder="Smith"
          />
        </Field>

        <Field label="NIB number" error={err('nibNumber')}>
          <Input
            name="nibNumber"
            defaultValue={values.nibNumber}
            placeholder="123-4567"
            disabled={nibExempt}
          />
          {nibExempt && (
            <p className="text-[11px] text-slate-500 mt-1">
              Disabled while NIB-exempt is on.
            </p>
          )}
        </Field>

        <Field label="Phone" error={err('phone')}>
          <Input
            name="phone"
            defaultValue={values.phone}
            placeholder="(242) 555-0123"
          />
        </Field>

        <Field label="Email" error={err('email')} className="md:col-span-2">
          <Input
            name="email"
            type="email"
            defaultValue={values.email}
            placeholder="employee@kraken.example"
          />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Compensation
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Employment type" error={err('employmentType')}>
            <Select
              name="employmentType"
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
            >
              {employmentTypeValues.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={`Pay rate (${PAY_RATE_BASIS_LABEL[employmentType]})`}
            error={err('payRate')}
          >
            <Input
              name="payRate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={values.payRate}
              placeholder="0.00"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {PAY_RATE_HINT[employmentType]}
            </p>
          </Field>
        </div>

        <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-3 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="nibExempt"
              checked={nibExempt}
              onChange={(e) => setNibExempt(e.target.checked)}
              className="h-4 w-4 mt-0.5 rounded border-slate-300"
            />
            <div>
              <span className="text-sm font-medium text-slate-900">
                NIB exempt
              </span>
              <p className="text-[11px] text-slate-600 mt-0.5">
                For expats and others not covered by Bahamas NIB. When on, no
                NIB is deducted from their paycheck, no employer NIB is owed,
                and they don't appear on the C-10 filing summary.
              </p>
            </div>
          </label>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Employment
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Hire date" error={err('hireDate')}>
            <Input
              name="hireDate"
              type="date"
              defaultValue={values.hireDate}
            />
          </Field>

          <Field label="Termination date" error={err('terminationDate')}>
            <Input
              name="terminationDate"
              type="date"
              defaultValue={values.terminationDate}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Leave blank for current employees.
            </p>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer">
          <input
            type="checkbox"
            name="active"
            defaultChecked={values.active}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span>Active — include in timesheets and payroll runs</span>
        </label>
      </fieldset>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Trade, certifications, etc."
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
              : 'Create employee'}
        </Button>
        <Link href={isEdit ? `/employees/${mode.id}` : '/employees'}>
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
