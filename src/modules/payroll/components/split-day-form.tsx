'use client';

// Percent-split a worker's day across jobs — "20% here, 60% there, 20%
// there". Direct action call inside a transition (not <form action>) so
// React 19 can't reset the row inputs on resolve; the server replaces the
// day's hours entries with one per job and the page refreshes via
// revalidatePath.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { splitDayAcrossJobsAction } from '../actions';

type Option = { id: string; label: string };
type Row = { projectId: string; percent: string };

export function SplitDayForm({
  employeeId,
  workDate,
  totalHours,
  projects,
}: {
  employeeId: string;
  workDate: string;
  /** Splittable pool (hours entries not claimed by a work order). */
  totalHours: number;
  projects: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([
    { projectId: '', percent: '60' },
    { projectId: '', percent: '40' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pctTotal = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Split day across jobs (%)
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900">
          Split {totalHours.toFixed(2)}h across jobs
        </p>
        <span
          className={
            'text-xs font-medium tabular-nums ' +
            (Math.abs(pctTotal - 100) < 0.01
              ? 'text-emerald-700'
              : 'text-amber-700')
          }
        >
          {pctTotal.toFixed(0)}% of 100%
        </span>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={r.projectId}
            onChange={(e) => setRow(i, { projectId: e.target.value })}
            className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            aria-label={`Job for row ${i + 1}`}
          >
            <option value="">— pick a job —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={100}
            value={r.percent}
            onChange={(e) => setRow(i, { percent: e.target.value })}
            className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-right tabular-nums"
            aria-label={`Percent for row ${i + 1}`}
          />
          <span className="text-xs text-slate-500 w-14 tabular-nums">
            {((totalHours * (Number(r.percent) || 0)) / 100).toFixed(2)}h
          </span>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              className="text-slate-400 hover:text-red-600 text-sm"
              aria-label="Remove row"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2">
        {rows.length < 8 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setRows((prev) => [...prev, { projectId: '', percent: '' }])
            }
          >
            + Add job
          </Button>
        )}
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            const parsed = rows
              .filter((r) => r.projectId !== '' || (Number(r.percent) || 0) > 0)
              .map((r) => ({
                projectId: r.projectId,
                percent: Number(r.percent) || 0,
              }));
            if (parsed.some((r) => !r.projectId)) {
              setError('Pick a job on every row.');
              return;
            }
            startTransition(async () => {
              const res = await splitDayAcrossJobsAction({
                employeeId,
                workDate,
                rows: parsed,
              });
              if (res.error) {
                setError(res.error);
                return;
              }
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {pending ? 'Splitting…' : 'Apply split'}
        </Button>
      </div>
      <p className="text-[11px] text-slate-500">
        Replaces this day&apos;s hour entries with one per job at the given
        percent — total hours and pay stay identical; only the job
        allocation changes. Work-order-claimed hours are left alone.
      </p>
    </div>
  );
}
