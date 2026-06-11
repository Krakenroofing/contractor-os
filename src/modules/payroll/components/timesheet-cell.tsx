'use client';

// One inline-editable timesheet cell. Hours on top (the record, for
// everyone); for variable-pay workers a $ pay input sits beneath it. Type
// a value, tab/Enter or blur to autosave. A blank or 0 clears the cell.
//
// A value of a given type that spans MORE THAN ONE row that day (e.g. hours
// split across two projects) isn't inline-editable — we render it as a
// link to the day-detail view so allocations are never silently merged.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { saveTimesheetCell } from '../actions';

export type TimesheetCellData = {
  employeeId: string;
  workDate: string;
  hours: number;
  hoursCount: number;
  pay: number;
  payCount: number;
  /** Variable-pay worker → render the $ pay input under the hours. */
  showPay: boolean;
  /** Permission AND period unlocked. Off → read-only cell. */
  canEdit: boolean;
};

export function TimesheetCell(props: TimesheetCellData) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <CellInput
        employeeId={props.employeeId}
        workDate={props.workDate}
        kind="hours"
        value={props.hours}
        count={props.hoursCount}
        canEdit={props.canEdit}
      />
      {props.showPay && (
        <CellInput
          employeeId={props.employeeId}
          workDate={props.workDate}
          kind="amount"
          value={props.pay}
          count={props.payCount}
          canEdit={props.canEdit}
        />
      )}
    </div>
  );
}

function CellInput({
  employeeId,
  workDate,
  kind,
  value,
  count,
  canEdit,
}: {
  employeeId: string;
  workDate: string;
  kind: 'hours' | 'amount';
  value: number;
  count: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initial = value > 0 ? value.toFixed(2) : '';
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const isMoney = kind === 'amount';
  // Multi-row days (or locked / no-permission) are read-only here.
  const editable = canEdit && count <= 1;

  if (!editable) {
    if (value <= 0) {
      return <span className="text-slate-300 tabular-nums text-sm">—</span>;
    }
    const display = isMoney ? formatMoney(value) : `${value.toFixed(2)}h`;
    return (
      <Link
        href={{ pathname: '/payroll/day', query: { employeeId, workDate } }}
        title={
          count > 1
            ? 'Multiple entries that day — click to edit on the day view'
            : undefined
        }
        className={`block tabular-nums hover:text-blue-700 ${
          isMoney ? 'text-emerald-700 text-xs' : 'text-slate-900 text-sm'
        }`}
      >
        {display}
        {count > 1 ? ' *' : ''}
      </Link>
    );
  }

  function commit() {
    const trimmed = text.trim();
    const num = trimmed === '' ? 0 : Number(trimmed);
    if (Number.isNaN(num) || num < 0) {
      setStatus('error');
      setError('Enter a number');
      return;
    }
    // No-op when unchanged (compare numerically so "150" == "150.00").
    if (num === value) {
      setStatus('idle');
      setError(null);
      return;
    }
    start(async () => {
      setStatus('idle');
      setError(null);
      const res = await saveTimesheetCell({ employeeId, workDate, kind, value: num });
      if (res?.error) {
        setStatus('error');
        setError(res.error);
      } else {
        setStatus('saved');
        // Re-fetch so totals + counts (and a brand-new row's identity)
        // reflect the change.
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-0.5" title={error ?? undefined}>
      {isMoney && <span className="text-[10px] text-emerald-600">$</span>}
      <input
        inputMode="decimal"
        value={text}
        disabled={pending}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setText(e.target.value);
          if (status !== 'idle') setStatus('idle');
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder={isMoney ? '0.00' : '0'}
        aria-label={isMoney ? 'Pay' : 'Hours'}
        className={`w-14 rounded border px-1 py-0.5 text-right text-sm tabular-nums focus:bg-white focus:outline-none disabled:opacity-50 ${
          isMoney ? 'text-emerald-700' : 'text-slate-900'
        } ${
          status === 'error'
            ? 'border-red-400 bg-red-50'
            : status === 'saved'
              ? 'border-emerald-300'
              : 'border-transparent hover:border-slate-300 focus:border-slate-400'
        }`}
      />
      {!isMoney && <span className="text-[10px] text-slate-400">h</span>}
    </span>
  );
}
