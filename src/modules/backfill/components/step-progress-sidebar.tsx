// Sidebar showing all 8 backfill steps with completion checkmarks. Server
// component — pulls counts from the backfill lib once per render.

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  BACKFILL_STEPS,
  STEP_LABEL,
  type BackfillStep,
  type BackfillStepCounts,
} from '@/modules/backfill/lib/backfill';

export function StepProgressSidebar({
  active,
  counts,
}: {
  active: BackfillStep | 'overview' | 'review';
  counts: BackfillStepCounts;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-3">
          Backfill steps
        </p>
        <ol className="space-y-1">
          <SidebarLink
            href="/backfill"
            label="Overview"
            stepNumber={null}
            active={active === 'overview'}
            count={null}
          />
          {BACKFILL_STEPS.map((step, i) => {
            const count = counts[step];
            return (
              <SidebarLink
                key={step}
                href={`/backfill/${step}`}
                label={STEP_LABEL[step]}
                stepNumber={i + 1}
                active={active === step}
                count={count}
              />
            );
          })}
          <SidebarLink
            href="/backfill/review"
            label="Review"
            stepNumber={null}
            active={active === 'review'}
            count={null}
          />
        </ol>
      </CardContent>
    </Card>
  );
}

function SidebarLink({
  href,
  label,
  stepNumber,
  active,
  count,
}: {
  href: string;
  label: string;
  stepNumber: number | null;
  active: boolean;
  count: number | null;
}) {
  const isComplete = count !== null && count > 0;
  return (
    <li>
      <Link
        href={{ pathname: href }}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          active
            ? 'bg-slate-900 text-white'
            : 'text-slate-700 hover:bg-slate-100'
        }`}
      >
        <span
          className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold ${
            active
              ? 'bg-white/20 text-white'
              : isComplete
                ? 'bg-emerald-100 text-emerald-700'
                : stepNumber === null
                  ? 'bg-slate-100 text-slate-500'
                  : 'bg-slate-200 text-slate-600'
          }`}
        >
          {isComplete && stepNumber !== null
            ? '✓'
            : stepNumber !== null
              ? stepNumber
              : '·'}
        </span>
        <span className="flex-1 truncate">{label}</span>
        {count !== null && count > 0 && (
          <span
            className={`text-[10px] tabular-nums ${
              active ? 'text-white/80' : 'text-slate-500'
            }`}
          >
            {count}
          </span>
        )}
      </Link>
    </li>
  );
}
