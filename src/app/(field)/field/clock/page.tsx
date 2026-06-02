// Clock in/out screen. The most-used field-app surface. Three sections:
//
//   1. Status banner — "Clocked in at X" or "Not on the clock". This is
//      the first thing the worker sees so they can tell at a glance.
//   2. Punch form — project picker + big button. Project remembered from
//      the open session if punching out.
//   3. Day summary — list of today's sessions with elapsed time.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import {
  getLatestClockEvent,
  listClockEventsForEmployeeRange,
  pairClockSessions,
} from '@/lib/data/clock-events';
import { listProjects } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { startOfDayInTZ, endOfDayInTZ, formatTimeInTZ } from '@/lib/tz';
import { ClockForm } from '@/modules/field/components/clock-form';

export const dynamic = 'force-dynamic';

export default async function FieldClockPage({
  searchParams,
}: {
  // `?project=<uuid>` — set when the worker taps a job from /field/jobs.
  // Used as the picker default only when they're NOT already clocked in
  // (so a deep-link can't accidentally switch the open session's
  // project without an explicit punch-out first).
  searchParams: Promise<{ project?: string }>;
}) {
  const employee = await getActiveEmployee();
  if (!employee) {
    // No employee link → can't clock. Send back home where the unlinked
    // warning explains what's missing.
    redirect('/field' as never);
  }

  const companyId = await getActiveCompanyId();

  // Build day window in the business TZ (APP_TZ = America/Nassau) so
  // "today" rolls over at midnight Nassau, not midnight UTC. The Vercel
  // server runs in UTC; without this, evening punches (8 PM – midnight
  // AST) would bucket into the next day.
  const now = new Date();
  const startOfDay = startOfDayInTZ(now);
  const endOfDay = endOfDayInTZ(now);

  const [latest, todayEvents, projects] = await Promise.all([
    getLatestClockEvent(employee.id),
    listClockEventsForEmployeeRange(employee.id, startOfDay, endOfDay),
    listProjects(companyId),
  ]);

  const isClockedIn = latest?.kind === 'in';
  const sessions = pairClockSessions(todayEvents);

  // Project picker options — project label + customer name when known so
  // the worker can tell "1234 Main" from "1234 Oak" at a glance. Skip
  // closed/lost projects since you can't clock against a dead job.
  const projectOptions = await Promise.all(
    projects
      .filter((p) => p.status !== 'closed' && p.status !== 'lost')
      .map(async (p) => {
        const customer = await getCustomer(companyId, p.customerId);
        return {
          id: p.id,
          label: `${p.name}${customer ? ` (${customer.name})` : ''}`,
        };
      }),
  );

  // Total minutes worked today across all closed sessions. Open session
  // is counted from in to now so the running total stays live.
  let totalMinutes = 0;
  for (const s of sessions) {
    const endTs = s.out ? s.out.occurredAt.getTime() : now.getTime();
    totalMinutes += Math.max(0, Math.round((endTs - s.in.occurredAt.getTime()) / 60000));
  }
  const totalH = Math.floor(totalMinutes / 60);
  const totalM = totalMinutes % 60;

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Time clock</h1>
        <Link href={{ pathname: '/field' }} className="text-xs text-slate-500">
          ← Home
        </Link>
      </header>

      {/* Status banner */}
      <div
        className={
          'rounded-xl border px-5 py-4 ' +
          (isClockedIn
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-slate-200 bg-white')
        }
      >
        <p
          className={
            'text-xs uppercase tracking-wide ' +
            (isClockedIn ? 'text-emerald-700' : 'text-slate-500')
          }
        >
          Status
        </p>
        <p
          className={
            'text-lg font-semibold ' +
            (isClockedIn ? 'text-emerald-900' : 'text-slate-900')
          }
        >
          {isClockedIn
            ? `Clocked in since ${formatTimeInTZ(latest!.occurredAt)}`
            : 'Not on the clock'}
        </p>
        {isClockedIn && latest?.projectId && (
          <p className="text-xs text-emerald-800 mt-1">
            On {projectOptions.find((p) => p.id === latest.projectId)?.label ?? 'a project'}
          </p>
        )}
        <p className="text-xs text-slate-600 mt-2">
          Today: {totalH}h {String(totalM).padStart(2, '0')}m across{' '}
          {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* Punch form */}
      <ClockForm
        isClockedIn={isClockedIn}
        projects={projectOptions}
        defaultProjectId={
          // Open session's project always wins (you don't want a stale
          // deep-link to change which job you're billed against
          // mid-shift). When not clocked in, prefer the ?project= deep
          // link from /field/jobs; otherwise blank.
          isClockedIn
            ? latest?.projectId ?? null
            : ((await searchParams).project ?? null)
        }
      />

      {/* Day summary */}
      {sessions.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <h2 className="px-5 pt-4 pb-2 text-sm font-semibold text-slate-900">
            Today&apos;s sessions
          </h2>
          <ul className="divide-y divide-slate-100">
            {sessions.map((s) => {
              const inTime = formatTimeInTZ(s.in.occurredAt);
              const outTime = s.out ? formatTimeInTZ(s.out.occurredAt) : 'now';
              const endTs = s.out ? s.out.occurredAt.getTime() : now.getTime();
              const mins = Math.max(
                0,
                Math.round((endTs - s.in.occurredAt.getTime()) / 60000),
              );
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              const projectLabel = s.in.projectId
                ? projectOptions.find((p) => p.id === s.in.projectId)?.label
                : null;
              return (
                <li key={s.in.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-900">
                      {inTime} → {outTime}
                    </span>
                    <span
                      className={
                        'text-sm font-medium ' +
                        (s.out ? 'text-slate-900' : 'text-emerald-700')
                      }
                    >
                      {h}h {String(m).padStart(2, '0')}m
                    </span>
                  </div>
                  {projectLabel && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {projectLabel}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-slate-400 text-center">
        Punches stamp your phone&apos;s clock + GPS (if enabled). Office can
        review and adjust on the desktop site.
      </p>
    </div>
  );
}
