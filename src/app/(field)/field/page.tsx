// Field app home. Phase M1 lays down the structure with placeholder cards
// — Phase M2 wires Clock In/Out, M3 wires Today's Jobs, M4 wires Daily
// Report. Each card is a big thumb-target so even on a 4" screen the
// worker can hit it with gloves on.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveEmployee } from '@/lib/active-employee';
import { getCurrentUser } from '@/lib/auth';
import { getLatestClockEvent } from '@/lib/data/clock-events';
import { listAssignmentsForEmployeeDate } from '@/lib/data/project-assignments';
import { formatTimeInTZ, formatDateLongInTZ, todayISOInTZ } from '@/lib/tz';

export const dynamic = 'force-dynamic';

export default async function FieldHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);
  const employee = await getActiveEmployee();
  // Drive the clock card's wording by current state. Skip the lookup
  // when there's no linked employee — the unlinked-warning banner
  // already explains nothing will work.
  const latest = employee ? await getLatestClockEvent(employee.id) : null;
  const isClockedIn = latest?.kind === 'in';

  // Today's assignment count for the "N jobs today" badge. "Today" is the
  // Nassau calendar day — NOT the server's UTC day, which would roll over
  // 4 hours early (8 PM Nassau onward shows tomorrow's jobs).
  const todayIso = todayISOInTZ();
  const todaysAssignments = employee
    ? await listAssignmentsForEmployeeDate(employee.id, todayIso)
    : [];

  const greetingName = employee
    ? employee.firstName
    : user.name?.split('@')[0] || 'there';

  // Today's date in a friendly format, in the business timezone. Server-
  // rendered (force-dynamic, no hydration concerns) — but the server runs
  // in UTC, so we must pin Nassau or the date label flips a day early in
  // the evening.
  const dateLine = formatDateLongInTZ(new Date());

  return (
    <div className="px-4 py-5 space-y-5">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900">
          Hi {greetingName} 👋
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">{dateLine}</p>
      </section>

      {!employee && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            You&apos;re signed in, but no employee record is linked to this
            account.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Most field-app features need this link so your time and daily
            reports get credited correctly. Ask your administrator to link
            your account on the Invite Users page.
          </p>
        </div>
      )}

      {/* Clock in/out card. Sized as the primary action on the screen
          (big, top-of-stack) because it's what a field worker opens the
          app to do most days. Wording flips to reflect current state. */}
      <ActionCard
        title={isClockedIn ? 'Clock out' : 'Clock in'}
        subtitle={
          isClockedIn
            ? `On the clock since ${formatTimeInTZ(latest!.occurredAt)}`
            : 'Start your work session'
        }
        tone="primary"
        href={employee ? '/field/clock' : undefined}
        disabled={!employee}
      />

      {/* Today's jobs card. Subtitle reflects the assignment count so a
          worker glances at home and sees "3 jobs today" without
          drilling in. */}
      <ActionCard
        title="Today&apos;s jobs"
        subtitle={
          !employee
            ? 'Needs employee link'
            : todaysAssignments.length === 0
              ? 'No assignments today'
              : `${todaysAssignments.length} job${todaysAssignments.length === 1 ? '' : 's'} scheduled`
        }
        href={employee ? '/field/jobs' : undefined}
        disabled={!employee}
      />

      {/* Submit daily report — jumps to the project picker. After save,
          the mobile detail page lets you add photos with the camera. */}
      <ActionCard
        title="Submit daily report"
        subtitle="Crew, scope, photos, work done"
        href={employee ? '/field/reports/new' : undefined}
        disabled={!employee}
      />

      {/* Note for office — a quick line (and optional photo) to flag anything
          for the office to handle. Doesn't need an employee link — anyone
          signed in can send one. Lands in the office dashboard inbox. */}
      <ActionCard
        title="Note for office"
        subtitle="Flag an issue or task for the office"
        href="/field/notes/new"
      />
    </div>
  );
}

function ActionCard({
  title,
  subtitle,
  tone = 'default',
  disabled = false,
  href,
}: {
  title: string;
  subtitle: string;
  tone?: 'default' | 'primary';
  disabled?: boolean;
  href?: string;
}) {
  const baseClasses =
    'block rounded-xl border px-5 py-5 transition active:scale-[0.99]';
  const toneClasses =
    tone === 'primary'
      ? 'border-blue-200 bg-blue-50'
      : 'border-slate-200 bg-white';
  const disabledClasses = disabled ? 'opacity-60' : 'hover:shadow-sm';

  const inner = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p
          className={
            'text-base font-semibold ' +
            (tone === 'primary' ? 'text-blue-900' : 'text-slate-900')
          }
        >
          {title}
        </p>
        <p
          className={
            'text-xs mt-0.5 ' +
            (tone === 'primary' ? 'text-blue-700' : 'text-slate-500')
          }
        >
          {subtitle}
        </p>
      </div>
      {disabled ? (
        <span className="text-[10px] uppercase tracking-wide rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-slate-500">
          Soon
        </span>
      ) : (
        <span
          className={
            tone === 'primary' ? 'text-blue-600' : 'text-slate-400'
          }
          aria-hidden
        >
          ›
        </span>
      )}
    </div>
  );

  if (disabled || !href) {
    return (
      <div className={`${baseClasses} ${toneClasses} ${disabledClasses}`}>
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={{ pathname: href }}
      className={`${baseClasses} ${toneClasses} ${disabledClasses}`}
    >
      {inner}
    </Link>
  );
}
