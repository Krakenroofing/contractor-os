'use client';

// Inline project + cost-code allocation for a single time entry, used on the
// day-detail grid. Built on the searchable Select combobox so long job / cost-
// code lists are filterable by typing.
//
// Controlled + saved via a direct action call inside a transition — NOT a
// <form action>. A form here would let React 19 reset the (uncontrolled) fields
// once the action resolves, snapping a fresh pick back to "— unassigned —" even
// though it saved. Holding the value in state keeps the selection on screen.
//
// Unassigned rows render amber so they pop out on the day grid.

import { useState, useTransition } from 'react';
import { Select } from '@/components/ui/select';
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
  const [project, setProject] = useState(
    isOverhead ? OVERHEAD_VALUE : projectId ?? '',
  );
  const [costCode, setCostCode] = useState(costCodeId ?? '');
  const [pending, startTransition] = useTransition();

  const unassigned = project === '';

  function save(nextProject: string, nextCostCode: string) {
    const fd = new FormData();
    fd.set('projectId', nextProject);
    fd.set('costCodeId', nextCostCode);
    startTransition(() => {
      void setTimeEntryAllocationAction(entryId, fd);
    });
  }

  const base = `text-xs max-w-[15rem]${pending ? ' opacity-60' : ''} `;

  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
      <Select
        value={project}
        aria-label="Allocate to project"
        className={
          base +
          (unassigned
            ? 'border-amber-300 bg-amber-50 text-amber-800'
            : 'border-slate-300 bg-white text-slate-700')
        }
        onChange={(e) => {
          setProject(e.target.value);
          save(e.target.value, costCode);
        }}
      >
        <option value="">— unassigned —</option>
        <option value={OVERHEAD_VALUE}>Overhead (no job)</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      <Select
        value={costCode}
        aria-label="Cost code"
        className={base + 'border-slate-300 bg-white text-slate-700'}
        onChange={(e) => {
          setCostCode(e.target.value);
          save(project, e.target.value);
        }}
      >
        <option value="">— cost code —</option>
        {costCodes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
