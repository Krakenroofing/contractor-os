'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  closePeriodsThroughAction,
  reopenPeriodAction,
} from '../period-actions';

export function ClosePeriodsForm({
  months,
  defaultMonth,
  lastClosedLabel,
}: {
  months: Array<{ value: string; label: string }>;
  defaultMonth: string;
  lastClosedLabel: string | null;
}) {
  const router = useRouter();
  const [through, setThrough] = useState(defaultMonth);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit() {
    const label = months.find((m) => m.value === through)?.label ?? through;
    if (
      !confirm(
        `Close every open month through ${label}?\n\nNothing dated in those months can be posted, edited, deleted, or re-dated afterwards — corrections go into an open period. Only the owner can reopen a month.`,
      )
    )
      return;
    start(async () => {
      setMsg(null);
      const res = await closePeriodsThroughAction(through);
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: res.message ?? 'Closed.' });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">Close the books</p>
        <p className="text-xs text-slate-500">
          {lastClosedLabel
            ? `Closed through ${lastClosedLabel} so far. `
            : 'No months closed yet. '}
          Closing takes a snapshot of each month&apos;s ledger so any later
          change would show up as a warning below.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-700">Close through</span>
        <div className="w-52">
          <Select value={through} onChange={(e) => setThrough(e.target.value)}>
            {[...months].reverse().map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? 'Closing…' : 'Close periods'}
        </Button>
      </div>
      {msg && (
        <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

export function ReopenPeriodButton({
  month,
  label,
}: {
  month: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reopen() {
    const reason = prompt(
      `Reopen ${label}?\n\nThis lets anything dated in ${label} be posted and changed again. The reopen is logged with your name — give the reason:`,
    );
    if (reason === null) return;
    start(async () => {
      setError(null);
      const res = await reopenPeriodAction(month, reason);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={reopen}
        disabled={pending}
        className="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900"
      >
        {pending ? 'Reopening…' : 'Reopen'}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
