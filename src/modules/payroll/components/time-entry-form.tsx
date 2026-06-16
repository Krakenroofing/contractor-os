'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CostCodePicker } from '@/modules/cost-codes/components/cost-code-picker';
import { EmployeePicker } from '@/modules/employees/components/employee-picker';
import {
  createTimeEntryAction,
  updateTimeEntryAction,
  type TimeEntryState,
} from '../actions';
import { OVERHEAD_VALUE } from '../schema';
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
  isOverhead: boolean;
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
  isOverhead: false,
  notes: '',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

const HOURLY_TYPES: ReadonlySet<EmploymentType> = new Set([
  'hourly',
  'salaried',
]);

function inferEntryType(employmentType: EmploymentType | undefined): 'hours' | 'amount' {
  if (!employmentType) return 'hours';
  return HOURLY_TYPES.has(employmentType) ? 'hours' : 'amount';
}

type AllocationRow = {
  /** UUID for a real project, OVERHEAD_VALUE for overhead, or '' for unassigned. */
  projectId: string;
  /** UUID for a cost code, or '' for none. */
  costCodeId: string;
  percent: string;
};

const makeBlankAllocation = (): AllocationRow => ({
  projectId: '',
  costCodeId: '',
  percent: '100',
});

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

  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    values.employeeId,
  );
  // Employees created inline via the picker, merged so a just-added worker
  // resolves for the pay-basis hints below.
  const [extraEmployees, setExtraEmployees] = useState<EmployeeOption[]>([]);
  const allEmployees = useMemo(
    () => [...extraEmployees, ...employees],
    [extraEmployees, employees],
  );
  const employeeMap = useMemo(
    () => new Map(allEmployees.map((e) => [e.id, e])),
    [allEmployees],
  );
  const selectedEmployee = employeeMap.get(selectedEmployeeId);
  const entryType: 'hours' | 'amount' = isEdit
    ? values.entryType
    : inferEntryType(selectedEmployee?.employmentType);

  // CREATE-mode allocation state. EDIT-mode uses a single project/cost-code
  // picker pulled from initial values (no allocation array, no percent).
  const [allocations, setAllocations] = useState<AllocationRow[]>(() => [
    makeBlankAllocation(),
  ]);

  const totalPercent = useMemo(
    () =>
      allocations.reduce((sum, a) => sum + (Number(a.percent) || 0), 0),
    [allocations],
  );
  const percentValid = Math.abs(totalPercent - 100) <= 0.01;

  function updateAllocation(idx: number, patch: Partial<AllocationRow>) {
    setAllocations((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    );
  }
  function addAllocation() {
    // New row gets the remaining percent. Helps the user finish to 100%.
    const remaining = Math.max(0, +(100 - totalPercent).toFixed(2));
    setAllocations((prev) => [
      ...prev,
      { projectId: '', costCodeId: '', percent: remaining.toString() },
    ]);
  }
  function removeAllocation(idx: number) {
    setAllocations((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  }

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
          <EmployeePicker
            name="employeeId"
            value={selectedEmployeeId}
            employees={allEmployees.map((e) => ({
              id: e.id,
              label: `${e.label} · ${EMPLOYMENT_TYPE_LABEL[e.employmentType]}`,
              employmentType: e.employmentType,
            }))}
            allowNone={false}
            placeholder="— Pick an employee —"
            required
            onChange={(id, emp) => {
              setSelectedEmployeeId(id);
              if (emp && !employeeMap.has(emp.id) && emp.employmentType) {
                setExtraEmployees((prev) => [
                  { id: emp.id, label: emp.label, employmentType: emp.employmentType! },
                  ...prev,
                ]);
              }
            }}
          />
          {selectedEmployee && !isEdit && (
            <p className="text-[11px] text-slate-500 mt-1">
              {entryType === 'hours'
                ? 'Hourly / salaried — enter hours worked, then allocate across projects.'
                : 'Variable pay — enter the amount earned, then allocate across projects.'}
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
          <Field
            label="Hours"
            error={err('hours')}
            required={selectedEmployee?.employmentType !== 'salaried'}
          >
            <Input
              name="hours"
              type="number"
              step="0.25"
              min="0"
              required={selectedEmployee?.employmentType !== 'salaried'}
              defaultValue={values.hours}
              placeholder={
                selectedEmployee?.employmentType === 'salaried'
                  ? '0.00 (optional)'
                  : '8.00'
              }
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {selectedEmployee?.employmentType === 'salaried'
                ? 'Optional for salaried. Pay comes from the weekly salary; hours are informational and used for project allocation.'
                : '0.25 hour resolution (15 min).'}
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
      </div>

      {isEdit ? (
        <EditAllocationFields
          err={err}
          initial={values}
          projects={projects}
          costCodes={costCodes}
        />
      ) : (
        <CreateAllocationFields
          allocations={allocations}
          totalPercent={totalPercent}
          percentValid={percentValid}
          projects={projects}
          costCodes={costCodes}
          onUpdate={updateAllocation}
          onAdd={addAllocation}
          onRemove={removeAllocation}
        />
      )}

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
        <Button
          type="submit"
          disabled={pending || (!isEdit && !percentValid)}
        >
          {pending
            ? isEdit
              ? 'Saving…'
              : 'Adding…'
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

/** Create-mode allocation list — repeatable rows summing to 100%. */
function CreateAllocationFields({
  allocations,
  totalPercent,
  percentValid,
  projects,
  costCodes,
  onUpdate,
  onAdd,
  onRemove,
}: {
  allocations: AllocationRow[];
  totalPercent: number;
  percentValid: boolean;
  projects: Option[];
  costCodes: Option[];
  onUpdate: (idx: number, patch: Partial<AllocationRow>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <legend className="px-1 text-sm font-medium text-slate-700">
          Allocation
        </legend>
        <span
          className={`text-xs tabular-nums ${percentValid ? 'text-emerald-700' : 'text-red-600'}`}
        >
          {totalPercent.toFixed(2)}% allocated
          {!percentValid && ' · must total 100%'}
        </span>
      </div>

      <p className="text-[11px] text-slate-500">
        Split this entry across one or more projects. Pick &ldquo;Overhead&rdquo;
        for non-billable company labor. Percents must sum to exactly 100%.
      </p>

      <div className="space-y-3">
        {allocations.map((row, idx) => (
          <div
            key={idx}
            className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end"
          >
            {/* Hidden inputs carry the values into FormData under array
                indices the server action knows how to parse. */}
            <input
              type="hidden"
              name={`allocations[${idx}].projectId`}
              value={row.projectId}
            />
            <input
              type="hidden"
              name={`allocations[${idx}].costCodeId`}
              value={row.costCodeId}
            />
            <input
              type="hidden"
              name={`allocations[${idx}].percent`}
              value={row.percent}
            />

            <div className="md:col-span-5">
              <Label className="text-xs">Project</Label>
              <Select
                value={row.projectId}
                onChange={(e) =>
                  onUpdate(idx, { projectId: e.target.value })
                }
              >
                <option value="">— Unassigned —</option>
                <option value={OVERHEAD_VALUE}>Overhead (non-project)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-4">
              <Label className="text-xs">Cost code</Label>
              <CostCodePicker
                value={row.costCodeId}
                options={costCodes}
                emptyLabel="— None —"
                onValueChange={(id) => onUpdate(idx, { costCodeId: id })}
              />
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs">%</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={row.percent}
                onChange={(e) =>
                  onUpdate(idx, { percent: e.target.value })
                }
                className="text-right tabular-nums"
              />
            </div>

            <div className="md:col-span-1 flex md:justify-end">
              {allocations.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(idx)}
                >
                  ×
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAdd}
          disabled={totalPercent >= 100}
        >
          + Add allocation
        </Button>
        {!percentValid && (
          <p className="text-xs text-red-600">
            Total is {totalPercent.toFixed(2)}% — adjust the rows so they sum
            to 100%.
          </p>
        )}
      </div>
    </fieldset>
  );
}

/** Edit-mode allocation — single project + cost code, no percent. The
 *  Project picker includes "Overhead" so an existing row can be flipped
 *  to / from overhead in place. */
function EditAllocationFields({
  err,
  initial,
  projects,
  costCodes,
}: {
  err: (key: string) => string | undefined;
  initial: TimeEntryFormInitialValues;
  projects: Option[];
  costCodes: Option[];
}) {
  const defaultProject = initial.isOverhead
    ? OVERHEAD_VALUE
    : initial.projectId;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Project / Overhead" error={err('projectId')}>
        <Select name="projectId" defaultValue={defaultProject}>
          <option value="">— Unassigned —</option>
          <option value={OVERHEAD_VALUE}>Overhead (non-project)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Cost code (optional)" error={err('costCodeId')}>
        <CostCodePicker
          name="costCodeId"
          defaultValue={initial.costCodeId}
          options={costCodes}
          emptyLabel="— None —"
        />
      </Field>
    </div>
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
