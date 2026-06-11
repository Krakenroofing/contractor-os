// Office-side clock-events review. Owner / PM / Accounting only.
// Two sections:
//   1. "On the clock now" — anyone whose latest punch is an 'in', so
//      you can see at a glance who's still working.
//   2. Day's punches — every paired session for the selected date,
//      grouped by employee, with review/edit/delete affordances.
//
// Date defaults to today in APP_TZ (Nassau). Pick a different date via
// the form below the header — submits as ?date=YYYY-MM-DD.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { getCompany } from '@/lib/data/companies';
import { listEmployees } from '@/lib/data/employees';
import { listProjects } from '@/lib/data/projects';
import {
  listClockEventsForCompanyRange,
  listOpenSessionsForCompany,
  listPostableSessions,
  pairClockSessions,
} from '@/lib/data/clock-events';
import {
  APP_TZ,
  endOfDayInTZ,
  formatTimeInTZ,
  startOfDayInTZ,
  todayISOInTZ,
} from '@/lib/tz';
import { DeletePunchButton } from '@/modules/clock-events/components/delete-punch-button';
import { SessionProjectSelect } from '@/modules/clock-events/components/session-project-select';
import {
  markSessionReviewedAction,
  postReviewedSessionsAction,
  setAutoPostClockSessionsAction,
  unmarkSessionReviewedAction,
} from '@/modules/clock-events/actions';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Thin alias over the shared helper so this page reads naturally; the
// timezone pinning lives in one place (src/lib/tz.ts).
const formatNassauTime = formatTimeInTZ;

function formatNassauDateLong(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: APP_TZ,
  });
}

function durationLabel(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export default async function ClockReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{
    date?: string;
    posted?: string;
    locked?: string;
    err?: string;
  }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'clock_events')) {
    redirect('/dashboard');
  }
  // Posting writes to time_entries → gated on payroll, not clock_events.
  // PMs can review punches but can't push them to payroll (matches the
  // existing permission split: clock_events RW, payroll NONE for PM).
  const canPost = canCreate(role, 'payroll');

  const sp = (await searchParams) ?? {};
  const date =
    sp.date && DATE_RE.test(sp.date) ? sp.date : todayISOInTZ();

  // Parse the post-result query params from a recent
  // postReviewedSessionsAction redirect. Any negative / NaN values are
  // ignored so a bookmark-style URL can't fake a confirmation banner.
  const postedCount = Number(sp.posted);
  const lockedCount = Number(sp.locked);
  const errCount = Number(sp.err);
  const showResultBanner =
    Number.isFinite(postedCount) &&
    Number.isFinite(lockedCount) &&
    Number.isFinite(errCount) &&
    (postedCount > 0 || lockedCount > 0 || errCount > 0);

  // Build the day window in APP_TZ so "today" is Nassau wall-clock,
  // not server-UTC. The reference instant is noon-UTC on the chosen
  // calendar day — any time inside that day in Nassau picks the same
  // calendar day after wallClockParts.
  const reference = new Date(`${date}T12:00:00Z`);
  const start = startOfDayInTZ(reference);
  const end = endOfDayInTZ(reference);

  const companyId = await getActiveCompanyId();
  const canEditSettings = canCreate(role, 'settings');
  // Editing/closing punches is gated on clock_events:create (PMs and up).
  // Drives the "Clock out" affordances on open sessions.
  const canEditPunches = canCreate(role, 'clock_events');

  const [company, employees, projects, events, openSessions, postableSessions] =
    await Promise.all([
      getCompany(companyId),
      listEmployees(companyId),
      listProjects(companyId),
      listClockEventsForCompanyRange(companyId, start, end),
      listOpenSessionsForCompany(companyId),
      listPostableSessions(companyId),
    ]);
  const postableCount = postableSessions.length;
  const autoPostOn = Boolean(company?.autoPostClockSessions);

  const employeeName = new Map(
    employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()] as const),
  );
  const projectName = new Map(
    projects.map((p) => [p.id, p.name] as const),
  );
  // Options for the inline session → project picker in the day grid.
  const projectOptions = projects.map((p) => ({ id: p.id, label: p.name }));

  // Group events by employee, pair into sessions per employee, then
  // flatten back so the table can render one row per session.
  const byEmployee = new Map<string, typeof events>();
  for (const e of events) {
    const list = byEmployee.get(e.employeeId) ?? [];
    list.push(e);
    byEmployee.set(e.employeeId, list);
  }

  type SessionRow = {
    key: string;
    employeeId: string;
    employeeLabel: string;
    inEvent: (typeof events)[number];
    outEvent: (typeof events)[number] | null;
    durationMs: number | null;
    reviewed: boolean;
    posted: boolean;
  };
  const sessionRows: SessionRow[] = [];
  for (const [employeeId, perEmp] of byEmployee.entries()) {
    const paired = pairClockSessions(perEmp);
    for (const s of paired) {
      const durationMs = s.out
        ? s.out.occurredAt.getTime() - s.in.occurredAt.getTime()
        : null;
      const reviewed = s.out
        ? Boolean(s.in.reviewedAt && s.out.reviewedAt)
        : Boolean(s.in.reviewedAt);
      // A session is "posted" once both punches carry a
      // posted_time_entry_id. We track both punches for symmetry even
      // though they always share the same FK after a successful post.
      const posted = s.out
        ? Boolean(s.in.postedTimeEntryId && s.out.postedTimeEntryId)
        : Boolean(s.in.postedTimeEntryId);
      sessionRows.push({
        key: s.in.id,
        employeeId,
        employeeLabel: employeeName.get(employeeId) ?? 'Unknown employee',
        inEvent: s.in,
        outEvent: s.out,
        durationMs,
        reviewed,
        posted,
      });
    }
  }
  // Sort by employee, then by clock-in time
  sessionRows.sort((a, b) => {
    if (a.employeeLabel !== b.employeeLabel) {
      return a.employeeLabel.localeCompare(b.employeeLabel);
    }
    return a.inEvent.occurredAt.getTime() - b.inEvent.occurredAt.getTime();
  });

  const totalSessions = sessionRows.length;
  const unreviewedCount = sessionRows.filter((r) => !r.reviewed).length;

  // "On the clock now" panel data
  const onClockRows = openSessions
    .map((e) => ({
      event: e,
      employeeLabel: employeeName.get(e.employeeId) ?? 'Unknown employee',
      projectLabel: e.projectId
        ? projectName.get(e.projectId) ?? '(deleted project)'
        : null,
      sinceMs: Date.now() - e.occurredAt.getTime(),
    }))
    .sort((a, b) => a.employeeLabel.localeCompare(b.employeeLabel));

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Time clock</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Review field punches before they post to payroll. All times in
          Nassau local time (America/Nassau).
        </p>
      </header>

      {/* Result banner from a recent post action. Cleared on next nav
          since the query params disappear when the date picker submits. */}
      {showResultBanner && (
        <div
          className={
            'rounded-md border px-4 py-3 text-sm ' +
            (errCount > 0
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900')
          }
        >
          Posted <strong>{postedCount}</strong> session
          {postedCount === 1 ? '' : 's'} to payroll.
          {lockedCount > 0 && (
            <>
              {' '}
              Skipped <strong>{lockedCount}</strong> in a locked pay period —
              unlock the period on /payroll to re-post.
            </>
          )}
          {errCount > 0 && (
            <>
              {' '}
              <strong>{errCount}</strong> failed unexpectedly — please retry
              or report.
            </>
          )}
        </div>
      )}

      {/* Post-to-payroll panel. Hidden entirely for roles without
          payroll:create (PMs review punches but can't push to payroll). */}
      {canPost && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>Post to payroll</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  {autoPostOn ? (
                    <>
                      <strong className="text-emerald-700">
                        Auto-post is ON
                      </strong>{' '}
                      — sessions post automatically when the worker clocks
                      out. The button below catches any stragglers (e.g.
                      back-filled punches that didn't trigger the live path).
                    </>
                  ) : (
                    <>
                      Reviewed sessions become one <code>time_entries</code>{' '}
                      row each. Posting into a locked pay period is refused
                      (skipped with a count).
                    </>
                  )}
                </p>
              </div>
              <form action={postReviewedSessionsAction}>
                <Button type="submit" disabled={postableCount === 0}>
                  {postableCount === 0
                    ? 'Nothing to post'
                    : `Post ${postableCount} session${postableCount === 1 ? '' : 's'}`}
                </Button>
              </form>
            </div>
          </CardHeader>
          {canEditSettings && (
            <CardContent className="border-t border-slate-100 pt-4">
              <form
                action={setAutoPostClockSessionsAction}
                className="flex items-center justify-between gap-3 flex-wrap"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Auto-post on clock-out
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Skip the review step — paired sessions post the instant
                    the worker punches out. Flip on once you trust the punch
                    data. Locked pay periods still block posting silently.
                  </p>
                </div>
                <input
                  type="hidden"
                  name="value"
                  value={autoPostOn ? 'off' : 'on'}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant={autoPostOn ? 'destructive' : 'outline'}
                >
                  {autoPostOn ? 'Turn off auto-post' : 'Turn on auto-post'}
                </Button>
              </form>
            </CardContent>
          )}
        </Card>
      )}

      {/* On the clock now */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>On the clock now</CardTitle>
            <Badge tone={onClockRows.length > 0 ? 'green' : 'slate'}>
              {onClockRows.length === 0
                ? 'nobody clocked in'
                : `${onClockRows.length} working`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {onClockRows.length === 0 ? (
            <p className="px-6 py-6 text-sm text-slate-500">
              No one is currently on the clock.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Elapsed</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>GPS</TableHead>
                  {canEditPunches && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {onClockRows.map((r) => (
                  <TableRow key={r.event.id}>
                    <TableCell className="text-slate-900 font-medium">
                      {r.employeeLabel}
                    </TableCell>
                    <TableCell className="text-slate-700 text-xs">
                      {formatNassauTime(r.event.occurredAt)}
                    </TableCell>
                    <TableCell
                      className={
                        'text-xs font-medium ' +
                        // Flag a session that's run unusually long (>16h) —
                        // almost always a forgotten clock-out.
                        (r.sinceMs > 16 * 3_600_000
                          ? 'text-amber-700'
                          : 'text-emerald-700')
                      }
                    >
                      {durationLabel(r.sinceMs)}
                    </TableCell>
                    <TableCell className="text-slate-700 text-xs">
                      {r.projectLabel ?? (
                        <span className="text-slate-400">— overhead —</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-500 text-xs">
                      {r.event.gpsLat && r.event.gpsLng
                        ? `${r.event.gpsLat}, ${r.event.gpsLng}`
                        : '—'}
                    </TableCell>
                    {canEditPunches && (
                      <TableCell className="text-right">
                        <Link
                          href={{
                            pathname: `/clock/${r.event.id}/close`,
                            query: { date: todayISOInTZ(r.event.occurredAt) },
                          }}
                        >
                          <Button size="sm" variant="outline">
                            Clock out
                          </Button>
                        </Link>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Date picker + day summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Punches for {formatNassauDateLong(date)}</CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {totalSessions} session{totalSessions === 1 ? '' : 's'} ·{' '}
                {unreviewedCount} awaiting review
              </p>
            </div>
            <form method="GET" className="flex items-end gap-2">
              <div>
                <label
                  htmlFor="date"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Date
                </label>
                <input
                  id="date"
                  type="date"
                  name="date"
                  defaultValue={date}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <Button type="submit" variant="outline" size="sm">
                Go
              </Button>
              {date !== todayISOInTZ() && (
                <Link
                  href={{ pathname: '/clock' as const }}
                  className="text-xs text-slate-500 underline self-center"
                >
                  Today
                </Link>
              )}
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {sessionRows.length === 0 ? (
            <p className="px-6 py-6 text-sm text-slate-500">
              No clock activity on this date.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionRows.map((r) => {
                  const projectLabel = r.inEvent.projectId
                    ? projectName.get(r.inEvent.projectId) ?? '(deleted)'
                    : null;
                  const ids = r.outEvent
                    ? [r.inEvent.id, r.outEvent.id]
                    : [r.inEvent.id];
                  return (
                    <TableRow key={r.key}>
                      <TableCell className="text-slate-900 text-sm">
                        {r.employeeLabel}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs">
                        {formatNassauTime(r.inEvent.occurredAt)}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs">
                        {r.outEvent ? (
                          formatNassauTime(r.outEvent.occurredAt)
                        ) : (
                          <Badge tone="amber">still on clock</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-900 text-xs font-medium">
                        {r.durationMs != null
                          ? durationLabel(r.durationMs)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs">
                        {r.posted ? (
                          projectLabel ?? (
                            <span className="text-slate-400">overhead</span>
                          )
                        ) : (
                          <SessionProjectSelect
                            inId={r.inEvent.id}
                            outId={r.outEvent?.id ?? null}
                            projectId={r.inEvent.projectId}
                            projects={projectOptions}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {r.posted ? (
                          <Badge tone="blue">posted to payroll</Badge>
                        ) : r.reviewed ? (
                          <Badge tone="green">reviewed</Badge>
                        ) : r.outEvent ? (
                          <Badge tone="slate">unreviewed</Badge>
                        ) : (
                          <Badge tone="amber">open</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {r.posted ? (
                            r.inEvent.postedTimeEntryId ? (
                              <Link
                                href={
                                  `/payroll/entries/${r.inEvent.postedTimeEntryId}/edit` as never
                                }
                                className="text-[11px] text-blue-600 hover:underline px-1"
                              >
                                Recode on payroll →
                              </Link>
                            ) : (
                              <span className="text-[11px] text-slate-500 px-1">
                                posted
                              </span>
                            )
                          ) : (
                            <>
                              {r.outEvent && !r.reviewed && (
                                <form
                                  action={markSessionReviewedAction.bind(null, ids)}
                                  className="inline"
                                >
                                  <Button type="submit" size="sm" variant="outline">
                                    Mark reviewed
                                  </Button>
                                </form>
                              )}
                              {r.reviewed && (
                                <form
                                  action={unmarkSessionReviewedAction.bind(null, ids)}
                                  className="inline"
                                >
                                  <Button type="submit" size="sm" variant="ghost">
                                    Un-review
                                  </Button>
                                </form>
                              )}
                              {!r.outEvent && (
                                <Link
                                  href={{
                                    pathname: `/clock/${r.inEvent.id}/close`,
                                    query: { date },
                                  }}
                                >
                                  <Button size="sm" variant="outline">
                                    Clock out
                                  </Button>
                                </Link>
                              )}
                              <Link
                                href={{
                                  pathname: `/clock/${r.inEvent.id}/edit`,
                                  query: { date },
                                }}
                              >
                                <Button size="sm" variant="ghost">
                                  Edit in
                                </Button>
                              </Link>
                              {r.outEvent && (
                                <Link
                                  href={{
                                    pathname: `/clock/${r.outEvent.id}/edit`,
                                    query: { date },
                                  }}
                                >
                                  <Button size="sm" variant="ghost">
                                    Edit out
                                  </Button>
                                </Link>
                              )}
                              <DeletePunchButton punchId={r.inEvent.id} />
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
