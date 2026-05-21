'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  addDays,
  formatPeriodLabel,
  mondayOf,
  todayISO,
} from '../lib/periods';

export function PeriodSelector({
  weekStart,
  weekEnd,
  status,
}: {
  weekStart: string;
  weekEnd: string;
  status: 'open' | 'locked';
}) {
  const router = useRouter();
  const prev = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  const thisWeek = mondayOf(todayISO());

  function jumpTo(week: string) {
    router.push(`/payroll?week=${week}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/payroll?week=${prev}`}>
        <Button variant="outline" size="sm">
          ← Previous week
        </Button>
      </Link>
      <div className="flex flex-col items-center min-w-[200px]">
        <span className="text-sm font-medium text-slate-900">
          {formatPeriodLabel(weekStart, weekEnd)}
        </span>
        <span className="text-xs text-slate-500">
          {status === 'locked' ? (
            <span className="text-amber-700">Locked</span>
          ) : (
            'Open for entry'
          )}
        </span>
      </div>
      <Link href={`/payroll?week=${next}`}>
        <Button variant="outline" size="sm">
          Next week →
        </Button>
      </Link>
      {weekStart !== thisWeek && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => jumpTo(thisWeek)}
        >
          Jump to this week
        </Button>
      )}
      <label className="inline-flex items-center gap-2 text-xs text-slate-600 ml-auto">
        <span>Go to date</span>
        <input
          type="date"
          defaultValue={weekStart}
          onChange={(e) => {
            if (e.target.value) jumpTo(mondayOf(e.target.value));
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
        />
      </label>
    </div>
  );
}
