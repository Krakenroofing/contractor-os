'use client';

// Punch form. Two visual modes — "clocked out → big green Clock In
// button" and "clocked in → big red Clock Out button" — but a single
// shared form so the project picker / notes layout stays consistent.
//
// GPS: we ask the browser Geolocation API for a single fix BEFORE
// submitting. If the worker denied permission or the fix takes too long,
// we proceed without coords — never block a punch on location.

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  punchInAction,
  punchOutAction,
  type PunchState,
} from '../actions';

const initial: PunchState = {};

type Props = {
  isClockedIn: boolean;
  projects: Array<{ id: string; label: string }>;
  defaultProjectId: string | null;
};

export function ClockForm({ isClockedIn, projects, defaultProjectId }: Props) {
  const action = isClockedIn ? punchOutAction : punchInAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const formRef = useRef<HTMLFormElement>(null);
  const [gpsStatus, setGpsStatus] = useState<
    'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable'
  >('idle');
  // Accuracy (metres) of the best fix we've stored — drives the hint so
  // the crew can tell a sharp jobsite fix from a coarse cell-tower guess.
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  // Best fix so far: its accuracy + when we took it. Lets us prefer a
  // tighter reading, but also refresh a stale one as the worker moves.
  const bestRef = useRef<{ accuracy: number; ts: number } | null>(null);

  // Job vs. overhead is an explicit choice when clocking in. Defaults to
  // "job" so the common case is one tap; "overhead" is the deliberate
  // yard / general path. Only surfaced when not already clocked in —
  // clock-out always carries the open session's project forward.
  const [mode, setMode] = useState<'job' | 'overhead'>('job');

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Continuously track location (watchPosition, not a single shot) so by
  // the time the worker taps the button we hold the freshest, tightest
  // fix — a cold GPS warm-up that first reports ±1500m gets superseded by
  // the ±10m reading a few seconds later. Permission is prompted on mount,
  // so the punch itself never waits on location. We never block a punch on
  // GPS: no fix just means the coords save empty.
  const beginCapture = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('unavailable');
      return;
    }
    stopWatch();
    bestRef.current = null;
    setGpsStatus('requesting');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        const now = Date.now();
        const best = bestRef.current;
        // Store a reading when it's our first, when it's tighter than the
        // best so far, or when the best is stale (>20s) so coords follow
        // the worker as they move around the site.
        const keep = !best || acc <= best.accuracy || now - best.ts > 20_000;
        if (!keep) return;
        bestRef.current = { accuracy: acc, ts: now };
        // Stash on the hidden inputs via DOM — the form action reads these
        // at submit, so the latest best fix always rides along.
        const f = formRef.current;
        if (f) {
          (f.elements.namedItem('gpsLat') as HTMLInputElement).value =
            String(pos.coords.latitude);
          (f.elements.namedItem('gpsLng') as HTMLInputElement).value =
            String(pos.coords.longitude);
          (f.elements.namedItem('gpsAccuracyM') as HTMLInputElement).value =
            String(acc);
        }
        setAccuracy(acc);
        setGpsStatus('ready');
        // A tight fix (≤20 m) pins the jobsite — stop watching to spare
        // battery. Coarse fixes keep the watch alive, trying to do better.
        if (acc <= 20) stopWatch();
      },
      (err) => {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3.
        if (err.code === 1) {
          stopWatch();
          setGpsStatus('denied');
        } else if (!bestRef.current) {
          // Only fall back to "unavailable" if we never got a fix — don't
          // discard a good earlier reading on a later transient timeout.
          setGpsStatus('unavailable');
        }
      },
      // Fresh readings only (no cache); high accuracy for jobsite-level
      // precision. Per-fix timeout keeps the watch from hanging silently.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }, [stopWatch]);

  useEffect(() => {
    beginCapture();
    return stopWatch;
  }, [beginCapture, stopWatch]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-xl border border-slate-200 bg-white px-5 py-5 space-y-4"
    >
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {/* GPS hidden inputs — populated by the effect above. Empty strings
          are treated as "no signal" by the server action. */}
      <input type="hidden" name="gpsLat" defaultValue="" />
      <input type="hidden" name="gpsLng" defaultValue="" />
      <input type="hidden" name="gpsAccuracyM" defaultValue="" />

      {isClockedIn ? (
        // Clock-out: single picker. Blank carries the open session's
        // project forward; picking a job overrides it for the out punch.
        <div className="space-y-1">
          <Label htmlFor="projectId" className="text-xs">
            Project (carry forward if blank)
          </Label>
          <Select
            name="projectId"
            id="projectId"
            defaultValue={defaultProjectId ?? ''}
          >
            <option value="">— Same job (carry forward) —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Job | Overhead toggle. The hidden `mode` input lets the
              server distinguish "deliberately on overhead" from "forgot to
              pick a job" — only the latter is rejected. */}
          <input type="hidden" name="mode" value={mode} />
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            {(['job', 'overhead'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  'h-10 rounded-md text-sm font-medium capitalize transition ' +
                  (mode === m
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700')
                }
              >
                {m}
              </button>
            ))}
          </div>

          {mode === 'job' ? (
            <div className="space-y-1">
              <Label htmlFor="projectId" className="text-xs">
                Project (required)
              </Label>
              <Select
                name="projectId"
                id="projectId"
                defaultValue={defaultProjectId ?? ''}
                required
              >
                <option value="">— Pick a job —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Overhead</Label>
              {/* Empty projectId → stored as null (overhead) server-side. */}
              <input type="hidden" name="projectId" value="" />
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                Yard / general — not on a specific job.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="notes" className="text-xs">
          Notes (optional)
        </Label>
        <Input
          id="notes"
          name="notes"
          maxLength={500}
          placeholder="e.g. picking up materials"
          className="text-base md:text-sm h-12 md:h-10"
        />
      </div>

      <div className="space-y-2">
        {/* Primary action — full-width chunky button. Color swaps based
            on which direction we're punching so the worker can't
            accidentally clock IN when they meant OUT. */}
        <Button
          type="submit"
          disabled={pending}
          className={
            'w-full h-16 text-lg font-semibold ' +
            (isClockedIn
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white')
          }
        >
          {pending
            ? isClockedIn
              ? 'Clocking out…'
              : 'Clocking in…'
            : isClockedIn
              ? 'Clock out'
              : 'Clock in'}
        </Button>

        {/* GPS hint — small, secondary. Never blocks the punch. */}
        <div className="text-center min-h-[16px]">
          {gpsStatus === 'requesting' && (
            <p className="text-[11px] text-slate-500">Getting location…</p>
          )}
          {gpsStatus === 'ready' && accuracy != null && (
            <p
              className={
                'text-[11px] ' +
                (accuracy <= 50 ? 'text-emerald-600' : 'text-amber-600')
              }
            >
              Location ✓ ±{Math.round(accuracy)}m
              {accuracy > 50 && ' — step outside for a sharper fix'}
            </p>
          )}
          {(gpsStatus === 'denied' || gpsStatus === 'unavailable') && (
            <p className="text-[11px] text-slate-500">
              {gpsStatus === 'denied'
                ? 'Location is off — the punch will save without GPS. '
                : "Couldn't get a location — the punch will save without GPS. "}
              <button
                type="button"
                onClick={beginCapture}
                className="font-medium text-blue-600 underline"
              >
                Retry
              </button>
            </p>
          )}
          {/* idle: nothing shown — capture starts on mount */}
        </div>
      </div>
    </form>
  );
}
