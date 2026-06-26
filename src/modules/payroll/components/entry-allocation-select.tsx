'use client';

// Inline project + cost-code allocation for a single time entry, used on the
// day-detail grid. Auto-submits on change so the office can job-cost a
// day-laborer's day rate (or any unassigned hours) in two taps — no trip to
// the per-entry edit form. Unassigned rows render amber so they pop out.

import { useRef } from 'react';
import { OVERHEAD_VALUE } from '../schema';
import { setTimeEntryAllocationAction } from '../actions';

type Option = { id: string; label: string };

export function EntryAllocationSelect({
  entryId,
  projectId,
  costCodeId,
  isOverhead,
  projects,
  costCodes,
}: {
  entryId: string;
  projectId: string | null;
  costCodeId: string | null;
  isOverhead: boolean;
  projects: Option[];
  costCodes: Option[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const action = setTimeEntryAllocationAction.bind(null, entryId);
  const projectValue = isOverhead ? OVERHEAD_VALUE : projectId ?? '';
  const unassigned = !projectId && !isOverhead;

  const submit = () => formRef.current?.requestSubmit();
  const selectClass =
    'rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 ';

  return (
    <form
      ref={formRef}
      action={action}
      className="flex flex-col gap-1.5 sm:flex-row sm:items-center"
    >
      <select
        name="projectId"
        defaultValue={projectValue}
        onChange={submit}
        aria-label="Allocate to project"
        className={
          selectClass +
          'max-w-[15rem] ' +
          (unassigned
            ? 'border-amber-300 bg-amber-50 text-amber-800'
            : 'border-slate-300 bg-white text-slate-700')
        }
      >
        <option value="">— unassigned —</option>
        <option value={OVERHEAD_VALUE}>Overhead (no job)</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <select
        name="costCodeId"
        defaultValue={costCodeId ?? ''}
        onChange={submit}
        aria-label="Cost code"
        className={selectClass + 'max-w-[15rem] border-slate-300 bg-white text-slate-700'}
      >
        <option value="">— cost code —</option>
        {costCodes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </form>
  );
}
