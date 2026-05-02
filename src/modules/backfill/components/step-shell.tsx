// Server component that wraps every backfill step page. Composes the
// progress sidebar, the breadcrumbs, the step header, and the step body.

import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import {
  BACKFILL_CUTOFF_ISO,
  STEP_DESCRIPTION,
  STEP_LABEL,
  type BackfillStep,
} from '@/modules/backfill/lib/backfill';
import { StepProgressSidebar } from './step-progress-sidebar';
import { getActiveCompanyId } from '@/lib/active-company';
import { getBackfillStepCounts } from '@/modules/backfill/lib/backfill';

export async function StepShell({
  step,
  children,
  prevHref,
  nextHref,
}: {
  step: BackfillStep | 'overview' | 'review';
  children: React.ReactNode;
  prevHref?: string;
  nextHref?: string;
}) {
  const companyId = await getActiveCompanyId();
  const counts = await getBackfillStepCounts(companyId);

  const isOverview = step === 'overview';
  const isReview = step === 'review';
  const title = isOverview
    ? 'Backfill — Overview'
    : isReview
      ? 'Backfill — Review'
      : `Backfill — ${STEP_LABEL[step as BackfillStep]}`;
  const description = isOverview
    ? `Enter historical business data starting from ${BACKFILL_CUTOFF_ISO}. The wizard walks you through 8 steps in dependency order — finish each step before moving on.`
    : isReview
      ? 'Aggregate KPIs and warnings across everything you have backfilled so far.'
      : STEP_DESCRIPTION[step as BackfillStep];

  return (
    <div className="p-8 max-w-[120rem] space-y-6">
      <Breadcrumbs
        items={[
          { href: '/backfill', label: 'Backfill' },
          { label: isOverview ? 'Overview' : isReview ? 'Review' : STEP_LABEL[step as BackfillStep] },
        ]}
      />

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-900">
        Backfill mode — every record entered here lands in the same tables as
        live data. Enter the original historical date for each record (don&apos;t
        leave dates blank — they would default to today). Cutoff: {BACKFILL_CUTOFF_ISO}.
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">{description}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6 items-start">
        <StepProgressSidebar active={step} counts={counts} />

        <div className="space-y-6 min-w-0">
          {children}

          {(prevHref || nextHref) && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
              <div>
                {prevHref && (
                  <Link href={{ pathname: prevHref }}>
                    <Button variant="outline" size="sm">
                      ← Previous step
                    </Button>
                  </Link>
                )}
              </div>
              <div>
                {nextHref && (
                  <Link href={{ pathname: nextHref }}>
                    <Button size="sm">Next step →</Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
