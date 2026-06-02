'use client';

// Inline session → project picker for the /clock day grid. Auto-submits
// on change so the office can recode an overhead session to the right
// job in one tap, without a trip to the per-punch edit page.
//
// Overhead (no project) rows render with an amber treatment so the
// miscoded sessions pop out of the grid at a glance — the whole point of
// this control is making "they forgot to pick a job" easy to spot and fix.

import { useRef } from 'react';
import { setSessionProjectAction } from '../actions';

type Option = { id: string; label: string };

export function SessionProjectSelect({
  inId,
  outId,
  projectId,
  projects,
}: {
  inId: string;
  outId: string | null;
  projectId: string | null;
  projects: Option[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const action = setSessionProjectAction.bind(null, inId, outId);
  const isOverhead = !projectId;

  return (
    <form ref={formRef} action={action}>
      <select
        name="projectId"
        defaultValue={projectId ?? ''}
        onChange={() => formRef.current?.requestSubmit()}
        aria-label="Reassign session to project"
        className={
          'rounded-md border px-2 py-1 text-xs max-w-[13rem] focus:outline-none focus:ring-2 focus:ring-slate-400 ' +
          (isOverhead
            ? 'border-amber-300 bg-amber-50 text-amber-800'
            : 'border-slate-300 bg-white text-slate-700')
        }
      >
        <option value="">— overhead (no job) —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </form>
  );
}
