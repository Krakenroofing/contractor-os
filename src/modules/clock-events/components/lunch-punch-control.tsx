'use client';

// Unpaid-lunch control on the Time Clock punches page. Edits the SAME
// per-(employee, work date) override the payroll math reads, so the timesheet
// and the punch review stay in sync. Shows the day's net paid hours after the
// break.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setLunchOverrideAction } from '@/modules/payroll/actions';

export function LunchPunchControl({
  employeeId,
  workDate,
  dayHours,
  lunchMinutes,
  canEdit,
}: {
  employeeId: string;
  workDate: string;
  dayHours: number;
  lunchMinutes: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const netPaid = Math.max(0, dayHours - lunchMinutes / 60);

  function change(v: string) {
    const minutes = v === '' ? null : Number(v);
    start(async () => {
      setError(null);
      const res = await setLunchOverrideAction({ employeeId, workDate, minutes });
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  if (!canEdit) {
    return (
      <span className="text-xs text-slate-500 tabular-nums">
        −{lunchMinutes}m · {netPaid.toFixed(2)}h
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
      title={error ?? 'Unpaid lunch break'}
    >
      <select
        value={String(lunchMinutes)}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label="Unpaid lunch minutes"
        className={`rounded border bg-white px-1.5 py-1 text-xs tabular-nums focus:outline-none ${
          error ? 'border-red-400 text-red-600' : 'border-slate-300 text-slate-700'
        }`}
      >
        <option value="">Auto</option>
        <option value="0">No lunch</option>
        <option value="30">30 min</option>
        <option value="45">45 min</option>
        <option value="60">60 min</option>
        <option value="90">90 min</option>
      </select>
      <span className="tabular-nums text-slate-500">
        {netPaid.toFixed(2)}h paid
      </span>
    </span>
  );
}
