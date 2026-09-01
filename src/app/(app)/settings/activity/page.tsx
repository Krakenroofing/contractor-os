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

export const dynamic = 'force-dynamic';

/** Someone whose heartbeat landed in the last 10 minutes is "online". */
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const WINDOW_DAYS = 30;

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
          Every session
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
            {sessions.map((s) => {
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
