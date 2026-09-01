import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCurrentUser } from '@/lib/auth';
import { ACTIVITY_OWNER_EMAIL } from '@/lib/activity-owner';
import {
  listLoginSessions,
  type LoginSessionRow,
} from '@/lib/data/login-sessions';
import { todayISOInTZ } from '@/lib/tz';

export const dynamic = 'force-dynamic';

/** Someone whose heartbeat landed in the last 10 minutes is "online". */
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
/** Fetch window — covers the weekly matrix (8 weeks) with a margin. */
const WINDOW_DAYS = 60;
const WEEKS_SHOWN = 8;
/** Cap the raw session list so 8 weeks of data doesn't render a monster. */
const MAX_SESSION_ROWS = 100;

function fmtWhen(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Nassau',
  });
}

function fmtDuration(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sessionEnd(s: LoginSessionRow): Date {
  return s.endedAt ?? s.lastSeenAt;
}

/** ISO date of the Monday starting the (Nassau-calendar) week `d` falls
 *  in. Weekday math runs in UTC on the extracted calendar date, so DST
 *  never shifts the boundary. */
function weekMondayISO(d: Date): string {
  const [y, m, day] = todayISOInTZ(d).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function weekLabel(mondayISO: string): string {
  const [y, m, d] = mondayISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function ActivityPage() {
  // Account gate, not a role gate: this page is for the app owner alone.
  const user = await getCurrentUser();
  if (!user || user.email !== ACTIVITY_OWNER_EMAIL) redirect('/dashboard');

  const now = Date.now();
  const sessions = await listLoginSessions(WINDOW_DAYS);

  // Per-user rollup over the window.
  const byUser = new Map<
    string,
    { name: string; email: string; totalMs: number; count: number; lastSeen: Date; online: boolean }
  >();
  for (const s of sessions) {
    const end = sessionEnd(s);
    const cur = byUser.get(s.userId) ?? {
      name: s.userName,
      email: s.userEmail,
      totalMs: 0,
      count: 0,
      lastSeen: end,
      online: false,
    };
    cur.totalMs += Math.max(0, end.getTime() - s.startedAt.getTime());
    cur.count += 1;
    if (end > cur.lastSeen) cur.lastSeen = end;
    if (!s.endedAt && now - s.lastSeenAt.getTime() < ONLINE_WINDOW_MS) cur.online = true;
    byUser.set(s.userId, cur);
  }
  const rollup = [...byUser.values()].sort((a, b) => b.totalMs - a.totalMs);

  // Weekly matrix: hours per person per Nassau-calendar week (Mon-start),
  // newest week first. A session counts toward the week it STARTED in —
  // the 6h-gap logic keeps sessions within a day, so no splitting needed.
  const weekKeys: string[] = [];
  {
    let cursor = new Date();
    for (let i = 0; i < WEEKS_SHOWN; i++) {
      const iso = weekMondayISO(cursor);
      weekKeys.push(iso);
      const [y, m, d] = iso.split('-').map(Number);
      cursor = new Date(Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000);
    }
  }
  const weekly = new Map<string, { name: string; byWeek: Map<string, number> }>();
  for (const s of sessions) {
    const wk = weekMondayISO(s.startedAt);
    const ms = Math.max(0, sessionEnd(s).getTime() - s.startedAt.getTime());
    const cur = weekly.get(s.userId) ?? { name: s.userName, byWeek: new Map() };
    cur.byWeek.set(wk, (cur.byWeek.get(wk) ?? 0) + ms);
    weekly.set(s.userId, cur);
  }
  const weeklyRows = [...weekly.values()].sort(
    (a, b) =>
      (b.byWeek.get(weekKeys[0]) ?? 0) + (b.byWeek.get(weekKeys[1]) ?? 0) -
      ((a.byWeek.get(weekKeys[0]) ?? 0) + (a.byWeek.get(weekKeys[1]) ?? 0)),
  );

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Link href="/settings">
        <Button variant="outline" size="sm">
          ← Back to Settings
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Sign-in activity</h1>
        <p className="text-sm text-slate-500 mt-1">
          Last {WINDOW_DAYS} days, all companies. Time on = sign-in until last
          activity (people rarely press Sign Out, so idle sessions close on
          their own). Only your account can open this page.
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white">
        <p className="px-4 pt-3 text-xs uppercase tracking-wide text-slate-500">
          By person
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Total time on</TableHead>
              <TableHead className="text-right">Last active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rollup.map((u) => (
              <TableRow key={u.email}>
                <TableCell>
                  <span className="font-medium text-slate-900">{u.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{u.email}</span>
                </TableCell>
                <TableCell>
                  {u.online ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 text-sm">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Online now
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400">Offline</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{u.count}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {fmtDuration(u.totalMs)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-600">
                  {fmtWhen(u.lastSeen)}
                </TableCell>
              </TableRow>
            ))}
            {rollup.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                  No sign-ins recorded yet. Sessions start appearing as people
                  log in (and as already-signed-in users navigate).
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <p className="px-4 pt-3 text-xs uppercase tracking-wide text-slate-500">
          Hours by week (Mon–Sun, last {WEEKS_SHOWN} weeks)
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                {weekKeys.map((wk) => (
                  <TableHead key={wk} className="text-right whitespace-nowrap">
                    {weekLabel(wk)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklyRows.map((u) => (
                <TableRow key={u.name}>
                  <TableCell className="font-medium text-slate-900 whitespace-nowrap">
                    {u.name}
                  </TableCell>
                  {weekKeys.map((wk) => {
                    const ms = u.byWeek.get(wk) ?? 0;
                    return (
                      <TableCell
                        key={wk}
                        className={`text-right tabular-nums ${
                          ms === 0 ? 'text-slate-300' : 'text-slate-700'
                        }`}
                      >
                        {ms === 0 ? '—' : fmtDuration(ms)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {weeklyRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={WEEKS_SHOWN + 1}
                    className="text-center text-slate-500 py-8"
                  >
                    No activity recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <p className="px-4 pt-3 text-xs uppercase tracking-wide text-slate-500">
          Recent sessions{' '}
          {sessions.length > MAX_SESSION_ROWS &&
            `(latest ${MAX_SESSION_ROWS} of ${sessions.length})`}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Signed in</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Device</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.slice(0, MAX_SESSION_ROWS).map((s) => {
              const end = sessionEnd(s);
              const online = !s.endedAt && now - s.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-slate-900">{s.userName}</TableCell>
                  <TableCell className="tabular-nums text-slate-600">
                    {fmtWhen(s.startedAt)}
                  </TableCell>
                  <TableCell className="tabular-nums text-slate-600">
                    {online ? (
                      <span className="text-emerald-700">Active now</span>
                    ) : (
                      fmtWhen(end)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtDuration(end.getTime() - s.startedAt.getTime())}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 max-w-[16rem] truncate">
                    {deviceLabel(s.userAgent)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Human-ish device label from the user agent — enough to tell phone vs
 *  desktop; never show the raw UA string. */
function deviceLabel(ua: string | null): string {
  if (!ua) return '—';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone / iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'Other';
}
