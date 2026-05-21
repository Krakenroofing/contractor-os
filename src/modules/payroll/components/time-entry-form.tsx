'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createTimeEntryAction,
  updateTimeEntryAction,
  type TimeEntryState,
} from '../actions';

type Option = { id: string; label: string };

export type TimeEntryFormInitialValues = {
  id?: string;
  employeeId: string;
  workDate: string;
  hours: string;
  projectId: string;
  costCodeId: string;
  notes: string;
};

const blankInitial: TimeEntryFormInitialValues = {
  employeeId: '',
  workDate: '',
  hours: '',
  projectId: '',
  costCodeId: '',
  notes: '',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

export function TimeEntryForm({
  mode = { kind: 'create' },
  initial,
  employees,
  projects,
  costCodes,
}: {
  mode?: Mode;
  initial?: TimeEntryFormInitialValues;
  employees: Option[];
  projects: Option[];
  costCodes: Option[];
}) {
  const values = initial ?? blankInitial;
  const isEdit = mode.kind === 'edit';

  const initialState: TimeEntryState = {};
  const [state, formAction, pending] = useActionState(
    isEdit ? updateTimeEntryAction : createTimeEntryAction,
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
        <Field label="Employee" error={err('employeeId')} required>
          <Select name="employeeId" defaultValue={values.employeeId} required>
            <option value="">— Pick an employee —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Work date" error={err('workDate')} required>
          <Input
            name="workDate"
            type="date"
            required
            defaultValue={values.workDate}
          />
        </Field>

        <Field label="Hours" error={err('hours')} required>
          <Input
            name="hours"
            type="number"
            step="0.25"
            min="0"
            max="24"
            required
            defaultValue={values.hours}
            placeholder="8.00"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            0.25 hour resolution (15 min). Max 24/day.
          </p>
        </Field>

        <Field label="Project (optional)" error={err('projectId')}>
          <Select name="projectId" defaultValue={values.projectId}>
            <option value="">— Unassigned —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-slate-500 mt-1">
            Leave blank for general timesheet hours. Pick a project to allocate
            the hours to that job.
          </p>
        </Field>

        <Field label="Cost code (optional)" error={err('costCodeId')} className="md:col-span-2">
          <Select name="costCodeId" defaultValue={values.costCodeId}>
            <option value="">— None —</option>
            {costCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="What was worked on, anything relevant for payroll review."
          defaultValue={values.notes}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? isEdit
              ? 'Saving…'
              : 'Adding…'
            : isEdit
              ? 'Save changes'
              : 'Add time entry'}
        </Button>
        <Link href="/payroll">
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
