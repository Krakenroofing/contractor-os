'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createProjectAction,
  updateProjectAction,
  type CreateProjectState,
  type UpdateProjectState,
} from '../actions';
import { projectStatusValues } from '../schema';

type ProjectStatus = (typeof projectStatusValues)[number];

export type ProjectFormInitialValues = {
  id?: string;
  customerId: string;
  name: string;
  status: ProjectStatus;
  jobsiteAddressLine1: string;
  jobsiteCity: string;
  jobsiteState: string;
  jobsitePostalCode: string;
  startDate: string;
  targetCompletionDate: string;
  contractValue: string;
  estimatedBudget: string;
  notes: string;
};

const blankInitial: ProjectFormInitialValues = {
  customerId: '',
  name: '',
  status: 'lead',
  jobsiteAddressLine1: '',
  jobsiteCity: '',
  jobsiteState: '',
  jobsitePostalCode: '',
  startDate: '',
  targetCompletionDate: '',
  contractValue: '0',
  estimatedBudget: '0',
  notes: '',
};

const statusLabel: Record<ProjectStatus, string> = {
  lead: 'Lead',
  estimating: 'Estimating',
  won: 'Won',
  in_progress: 'In Progress',
  closed: 'Closed',
  lost: 'Lost',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

export function ProjectForm({
  customers,
  mode = { kind: 'create' },
  initial,
}: {
  customers: { id: string; name: string }[];
  mode?: Mode;
  initial?: ProjectFormInitialValues;
}) {
  const values = initial ?? blankInitial;
  const isEdit = mode.kind === 'edit';

  const initialState: CreateProjectState | UpdateProjectState = {};
  const [state, formAction, pending] = useActionState(
    isEdit ? updateProjectAction : createProjectAction,
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
        <Field label="Project name" error={err('name')} className="md:col-span-2" required>
          <Input
            name="name"
            placeholder="Smith residence — full roof replacement"
            required
            defaultValue={values.name}
          />
        </Field>

        <Field label="Customer" error={err('customerId')} required>
          <Select name="customerId" required defaultValue={values.customerId}>
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

        <Field label="Status" error={err('status')}>
          <Select name="status" defaultValue={values.status}>
            {projectStatusValues.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Base contract value (net, ex-VAT, before change orders)"
          error={err('contractValue')}
          hint={
            <>
              Enter the <strong>signed contract amount before VAT</strong> and{' '}
              <strong>before any change orders</strong>. Approved change
              orders are tracked separately and roll up into the Revised
              Contract figure on the project page. Example: signed contract
              $110,000 incl. 10% VAT → enter $100,000 here. The system
              auto-recomputes the revised total ({' '}base + approved COs)
              on save.
            </>
          }
        >
          <Input
            name="contractValue"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={values.contractValue}
          />
        </Field>

        <Field label="Estimated budget" error={err('estimatedBudget')}>
          <Input
            name="estimatedBudget"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={values.estimatedBudget}
          />
        </Field>

        <Field label="Start date" error={err('startDate')}>
          <Input name="startDate" type="date" defaultValue={values.startDate} />
        </Field>

        <Field label="Target completion" error={err('targetCompletionDate')}>
          <Input
            name="targetCompletionDate"
            type="date"
            defaultValue={values.targetCompletionDate}
          />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Jobsite address</legend>
        <Field label="Street" error={err('jobsiteAddressLine1')}>
          <Input
            name="jobsiteAddressLine1"
            defaultValue={values.jobsiteAddressLine1}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City" error={err('jobsiteCity')}>
            <Input name="jobsiteCity" defaultValue={values.jobsiteCity} />
          </Field>
          <Field label="State" error={err('jobsiteState')}>
            <Input name="jobsiteState" defaultValue={values.jobsiteState} />
          </Field>
          <Field label="Postal code" error={err('jobsitePostalCode')}>
            <Input
              name="jobsitePostalCode"
              defaultValue={values.jobsitePostalCode}
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
          {pending
            ? isEdit
              ? 'Saving…'
              : 'Creating…'
            : isEdit
              ? 'Save changes'
              : 'Create project'}
        </Button>
        <Link href={isEdit ? `/projects/${mode.id}` : '/projects'}>
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
  hint,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
  /** Optional helper text rendered under the input. Use to explain a
   *  non-obvious data convention (e.g. "enter net, ex-VAT") so operators
   *  don't have to guess. */
  hint?: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
