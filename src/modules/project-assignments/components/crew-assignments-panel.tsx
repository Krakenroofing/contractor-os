'use client';

// Admin-side panel on /projects/[id] that lets owner/PM assign employees
// to specific dates. Server-rendered list of existing rows + an inline
// add form. Per-row delete button.

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createAssignmentAction,
  deleteAssignmentAction,
  type AssignmentState,
} from '../actions';

const initial: AssignmentState = {};

type Assignment = {
  id: string;
  employeeId: string;
  assignedDate: string;
  roleLabel: string | null;
  notes: string | null;
};

type EmployeeOpt = { id: string; label: string };

export function CrewAssignmentsPanel({
  projectId,
  assignments,
  employees,
  defaultDate,
  canManage,
}: {
  projectId: string;
  assignments: Assignment[];
  employees: EmployeeOpt[];
  defaultDate: string;
  canManage: boolean;
}) {
  const employeeName = useMemo(
    () => new Map(employees.map((e) => [e.id, e.label])),
    [employees],
  );

  // Group assignments by date so the admin scans a "schedule" view, not
  // an undifferentiated list. Today bucket pops to the top, then the
  // remaining dates in chronological order.
  const grouped = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const bucket = m.get(a.assignedDate) ?? [];
      bucket.push(a);
      m.set(a.assignedDate, bucket);
    }
    const dates = Array.from(m.keys()).sort();
    return dates.map((d) => ({ date: d, rows: m.get(d)! }));
  }, [assignments]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Crew assignments ({assignments.length})</CardTitle>
          <span className="text-xs text-slate-500">
            Drives the field app&apos;s &quot;today&apos;s jobs&quot; view
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <AssignmentAddForm
            projectId={projectId}
            employees={employees}
            defaultDate={defaultDate}
          />
        )}

        {grouped.length === 0 ? (
          <p className="text-sm text-slate-500">
            No assignments yet. Add a date + employee above to schedule the
            crew. Assigned workers see this project on their phone&apos;s
            &quot;today&apos;s jobs&quot; list.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {grouped.map(({ date, rows }) => (
              <li key={date} className="px-4 py-3 space-y-1">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {formatDate(date)}
                </p>
                <ul className="space-y-1">
                  {rows.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex-1">
                        <p className="text-sm text-slate-900">
                          {employeeName.get(a.employeeId) ?? '(unknown)'}
                          {a.roleLabel && (
                            <span className="ml-2 text-xs text-slate-500">
                              · {a.roleLabel}
                            </span>
                          )}
                        </p>
                        {a.notes && (
                          <p className="text-xs text-slate-500">{a.notes}</p>
                        )}
                      </div>
                      {canManage && (
                        <DeleteAssignmentButton
                          id={a.id}
                          projectId={projectId}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AssignmentAddForm({
  projectId,
  employees,
  defaultDate,
}: {
  projectId: string;
  employees: EmployeeOpt[];
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(
    createAssignmentAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Reset the form after a successful add so the admin can chain
  // multiple assignments without re-typing the date.
  useEffect(() => {
    if (state.ok && !state.formError) {
      formRef.current?.reset();
    }
  }, [state.ok, state.formError]);

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2"
    >
      {state.formError && (
        <p className="text-xs text-red-700">{state.formError}</p>
      )}
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="assignedDate" className="text-xs">
            Date
          </Label>
          <Input
            id="assignedDate"
            name="assignedDate"
            type="date"
            defaultValue={defaultDate}
            required
          />
          {err('assignedDate') && (
            <p className="text-xs text-red-600">{err('assignedDate')}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="employeeId" className="text-xs">
            Employee
          </Label>
          <Select name="employeeId" id="employeeId" required defaultValue="">
            <option value="" disabled>
              Pick…
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
          {err('employeeId') && (
            <p className="text-xs text-red-600">{err('employeeId')}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="roleLabel" className="text-xs">
            Role (optional)
          </Label>
          <Input
            id="roleLabel"
            name="roleLabel"
            maxLength={100}
            placeholder="e.g. Foreman"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes" className="text-xs">
          Notes for the crew (optional)
        </Label>
        <Input
          id="notes"
          name="notes"
          maxLength={500}
          placeholder="e.g. 7am start, bring the long ladder"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Assigning…' : 'Assign'}
      </Button>
    </form>
  );
}

function DeleteAssignmentButton({
  id,
  projectId,
}: {
  id: string;
  projectId: string;
}) {
  const [_state, formAction, pending] = useActionState(
    deleteAssignmentAction,
    initial,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Remove this assignment?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        className="text-xs"
      >
        Remove
      </Button>
    </form>
  );
}

/**
 * Friendly date label. Today + tomorrow get prefixed so the schedule
 * reads naturally; everything else falls back to the local-format
 * "Wed, May 28" style.
 */
function formatDate(iso: string): string {
  // Parse as local date (not UTC) so we don't shift dates near midnight.
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (dt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  const formatted = dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  if (diff === 0) return `Today · ${formatted}`;
  if (diff === 1) return `Tomorrow · ${formatted}`;
  if (diff === -1) return `Yesterday · ${formatted}`;
  return formatted;
}
