'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createProjectAction, type CreateProjectState } from '../actions';
import { projectStatusValues } from '../schema';

const initialState: CreateProjectState = {};

const statusLabel: Record<(typeof projectStatusValues)[number], string> = {
  lead: 'Lead',
  estimating: 'Estimating',
  won: 'Won',
  in_progress: 'In Progress',
  closed: 'Closed',
  lost: 'Lost',
};

export function ProjectForm({
  customers,
}: {
  customers: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Project number" error={err('number')} required>
          <Input name="number" placeholder="2026-004" required />
        </Field>

        <Field label="Status" error={err('status')}>
          <Select name="status" defaultValue="lead">
            {projectStatusValues.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Project name" error={err('name')} className="md:col-span-2" required>
          <Input name="name" placeholder="Smith residence — full roof replacement" required />
        </Field>

        <Field label="Customer" error={err('customerId')} className="md:col-span-2" required>
          <Select name="customerId" required defaultValue="">
            <option value="" disabled>
              {customers.length === 0
                ? 'No customers — create one first'
                : 'Select a customer'}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Contract value" error={err('contractValue')}>
          <Input
            name="contractValue"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue="0"
          />
        </Field>

        <Field label="Estimated budget" error={err('estimatedBudget')}>
          <Input
            name="estimatedBudget"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue="0"
          />
        </Field>

        <Field label="Start date" error={err('startDate')}>
          <Input name="startDate" type="date" />
        </Field>

        <Field label="Target completion" error={err('targetCompletionDate')}>
          <Input name="targetCompletionDate" type="date" />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Jobsite address</legend>
        <Field label="Street" error={err('jobsiteAddressLine1')}>
          <Input name="jobsiteAddressLine1" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City" error={err('jobsiteCity')}>
            <Input name="jobsiteCity" />
          </Field>
          <Field label="State" error={err('jobsiteState')}>
            <Input name="jobsiteState" />
          </Field>
          <Field label="Postal code" error={err('jobsitePostalCode')}>
            <Input name="jobsitePostalCode" />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create project'}
        </Button>
        <Link href="/projects">
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
