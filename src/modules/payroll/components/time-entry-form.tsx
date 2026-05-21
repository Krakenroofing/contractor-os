'use client';

import { useActionState, useMemo, useState } from 'react';
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
import {
  EMPLOYMENT_TYPE_LABEL,
  type EmploymentType,
} from '@/modules/employees/schema';

type EmployeeOption = {
  id: string;
  label: string;
  employmentType: EmploymentType;
};
type Option = { id: string; label: string };

export type TimeEntryFormInitialValues = {
  id?: string;
  employeeId: string;
  workDate: string;
  entryType: 'hours' | 'amount';
  hours: string;
  amount: string;
  projectId: string;
  costCodeId: string;
  notes: string;
};

const blankInitial: TimeEntryFormInitialValues = {
  employeeId: '',
  workDate: '',
  entryType: 'hours',
  hours: '',
  amount: '',
  projectId: '',
  costCodeId: '',
  notes: '',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

/**
 * Employee types that get paid by the hour. Everything else is paid by
 * direct amount — the form switches between Hours and Amount inputs as
 * soon as the user picks an employee.
 */
const HOURLY_TYPES: ReadonlySet<EmploymentType> = new Set([
  'hourly',
  'salaried',
]);

function inferEntryType(employmentType: EmploymentType | undefined): 'hours' | 'amount' {
  if (!employmentType) return 'hours';
  return HOURLY_TYPES.has(employmentType) ? 'hours' : 'amount';
}

export function TimeEntryForm({
  mode = { kind: 'create' },
  initial,
  employees,
  projects,
  costCodes,
}: {
  mode?: Mode;
  initial?: TimeEntryFormInitialValues;
  employees: EmployeeOption[];
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

  // Track the currently-selected employee so the form can switch field
  // sets without a page round-trip. On edit, honor whatever entry_type
  // was stored — that way fixing a typo on an existing row doesn't
  // accidentally change its type based on the employee's current
  // setting.
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    values.employeeId,
  );
  const employeeMap = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );
  const selectedEmployee = employeeMap.get(selectedEmployeeId);

  // Source of truth for which input renders:
  //   - On create: derived from the selected employee's type.
  //   - On edit: the stored entry_type (which itself was set per the
  //     employee's type when the row was created).
  const entryType: 'hours' | 'amount' = isEdit
    ? values.entryType
    : inferEntryType(selectedEmployee?.employmentType);

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {isEdit && <input type="hidden" name="id" value={mode.id} />}
      <input type="hidden" name="entryType" value={entryType} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Employee" error={err('employeeId')} required>
          <Select
            name="employeeId"
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            required
          >
            <option value="">— Pick an employee —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
                {' · '}
                {EMPLOYMENT_TYPE_LABEL[e.employmentType]}
              </option>
            ))}
          </Select>
          {selectedEmployee && !isEdit && (
            <p className="text-[11px] text-slate-500 mt-1">
              {entryType === 'hours'
                ? 'Hourly / salaried — enter hours worked.'
                : 'Variable pay — enter the amount earned (commission, piecework, contract, etc.).'}
            </p>
          )}
        </Field>

        <Field label="Work date" error={err('workDate')} required>
          <Input
            name="workDate"
            type="date"
            required
            defaultValue={values.workDate}
          />
        </Field>

        {entryType === 'hours' ? (
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
        ) : (
          <Field label="Amount earned" error={err('amount')} required>
            <Input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={values.amount}
              placeholder="0.00"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Direct pay for this date. Multiple entries in the same week
              sum to the period gross.
            </p>
          </Field>
        )}

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
            Leave blank for general work. Pick a project to allocate the entry
            to that job.
          </p>
        </Field>

        <Field
          label="Cost code (optional)"
          error={err('costCodeId')}
          className="md:col-span-2"
        >
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
          placeholder={
            entryType === 'amount'
              ? 'Scope completed, sale reference, etc.'
              : 'What was worked on, anything relevant for payroll review.'
          }
          defaultValue={values.notes}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? isEdit
              ? 'Saving…'
              : entryType === 'amount'
                ? 'Adding pay…'
                : 'Adding hours…'
            : isEdit
              ? 'Save changes'
              : entryType === 'amount'
                ? 'Add pay entry'
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
