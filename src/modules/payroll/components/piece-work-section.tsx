'use client';

// Piece work on the Pay Run: one-off job-allocated pay lines. Unlike a
// paystub adjustment (per diem / bonus / etc.), a piece-work line is a real
// time entry (entry_type='amount') tied to a project + cost code — so it
// ADDS to the employee's gross AND posts to job costs via "Post labor to job
// costs". Project + cost code are required; that's the whole point.

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import { addPieceWorkEntryAction, type PieceWorkState } from '../actions';

type Option = { id: string; label: string };
type PieceWorkLine = {
  id: string;
  amount: number;
  date: string;
  projectLabel: string;
};
type EmployeeRow = {
  employeeId: string;
  name: string;
  lines: PieceWorkLine[];
};

export function PieceWorkSection({
  rows,
  projects,
  costCodes,
  periodStart,
  periodEnd,
  locked,
}: {
  rows: EmployeeRow[];
  projects: Option[];
  costCodes: Option[];
  periodStart: string;
  periodEnd: string;
  locked: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-medium text-slate-700">Piece work</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          One-off pay for work on a job — allocate it to a project + cost code.
          It adds to the employee&rsquo;s gross and posts to job costs.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((r) => {
          const total = r.lines.reduce((a, l) => a + l.amount, 0);
          return (
            <details key={r.employeeId} className="px-4 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
                <span className="font-medium text-slate-900">{r.name}</span>
                <span className="text-xs text-slate-500">
                  {r.lines.length > 0
                    ? `${formatMoney(total)} on jobs`
                    : 'none'}{' '}
                  · <span className="text-blue-600">add ▸</span>
                </span>
              </summary>
              <div className="pt-2 pb-1">
                <PieceWorkEditor
                  employeeId={r.employeeId}
                  lines={r.lines}
                  projects={projects}
                  costCodes={costCodes}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                  locked={locked}
                />
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function PieceWorkEditor({
  employeeId,
  lines,
  projects,
  costCodes,
  periodStart,
  periodEnd,
  locked,
}: {
  employeeId: string;
  lines: PieceWorkLine[];
  projects: Option[];
  costCodes: Option[];
  periodStart: string;
  periodEnd: string;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<PieceWorkState, FormData>(
    addPieceWorkEntryAction,
    {},
  );

  return (
    <div className="space-y-2">
      {lines.length > 0 && (
        <ul className="space-y-1 text-sm">
          {lines.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5"
            >
              <span className="min-w-0 truncate text-slate-700">
                {l.projectLabel}{' '}
                <span className="text-xs text-slate-400">· {l.date}</span>
              </span>
              <span className="tabular-nums font-medium text-emerald-700">
                +{formatMoney(l.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        // Remount (clearing the inputs) once an add succeeds and a new line
        // appears, so the next entry starts blank.
        <form
          key={lines.length}
          action={action}
          className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2"
        >
          <input type="hidden" name="employeeId" value={employeeId} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-500">
              Amount
              <Input
                type="number"
                step="0.01"
                min="0"
                name="amount"
                placeholder="0.00"
                className="mt-0.5 text-right tabular-nums"
                required
              />
            </label>
            <label className="text-xs text-slate-500">
              Date
              <Input
                type="date"
                name="workDate"
                defaultValue={periodEnd}
                min={periodStart}
                max={periodEnd}
                className="mt-0.5"
                required
              />
            </label>
            <label className="text-xs text-slate-500">
              Job
              <Select name="projectId" defaultValue="" required className="mt-0.5">
                <option value="" disabled>
                  Select a job…
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-slate-500">
              Cost code
              <Select name="costCodeId" defaultValue="" required className="mt-0.5">
                <option value="" disabled>
                  Select a cost code…
                </option>
                {costCodes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <Input
            type="text"
            name="notes"
            placeholder="Note (optional)"
            maxLength={500}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Adding…' : 'Add piece work'}
            </Button>
            {state.error && (
              <p className="text-xs text-red-600">{state.error}</p>
            )}
            {state.ok && (
              <p className="text-xs text-emerald-600">Added.</p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
