'use client';

// Punch form. Two visual modes — "clocked out → big green Clock In
// button" and "clocked in → big red Clock Out button" — but a single
// shared form so the project picker / notes layout stays consistent.
//
// GPS: we ask the browser Geolocation API for a single fix BEFORE
// submitting. If the worker denied permission or the fix takes too long,
// we proceed without coords — never block a punch on location.

import { useActionState, useEffect, useRef, useState } from 'react';
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

  // Fire-and-forget geolocation request when the page mounts. The OS
  // permission prompt happens here (not on button tap) so the punch
  // itself feels instantaneous — by the time the user taps the button,
  // we either have a fix or we know we don't.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('unavailable');
      return;
    }
    setGpsStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsStatus('ready');
        // Stash on the form's hidden inputs via DOM — useState would
        // trigger a re-render that pessimizes the form input.
        const f = formRef.current;
        if (!f) return;
        (f.elements.namedItem('gpsLat') as HTMLInputElement).value =
          String(pos.coords.latitude);
        (f.elements.namedItem('gpsLng') as HTMLInputElement).value =
          String(pos.coords.longitude);
        (f.elements.namedItem('gpsAccuracyM') as HTMLInputElement).value =
          String(pos.coords.accuracy);
      },
      (err) => {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        setGpsStatus(err.code === 1 ? 'denied' : 'unavailable');
      },
      // High accuracy is worth the extra battery — punches are infrequent
      // and we want to know which jobsite the worker is on, not just
      // which neighbourhood. Timeout prevents the request hanging
      // forever when indoors with no signal.
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

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

      <div className="space-y-1">
        <Label htmlFor="projectId" className="text-xs">
          {isClockedIn ? 'Project (carry forward if blank)' : 'Project'}
        </Label>
        <Select
          name="projectId"
          id="projectId"
          defaultValue={defaultProjectId ?? ''}
        >
          <option value="">— No project (yard / general) —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

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
        <p className="text-[11px] text-slate-500 text-center">
          {gpsStatus === 'requesting' && 'Getting location…'}
          {gpsStatus === 'ready' && 'Location captured ✓'}
          {gpsStatus === 'denied' &&
            'Location off — punch will save without GPS'}
          {gpsStatus === 'unavailable' &&
            "Couldn't get location — punch will save without GPS"}
          {gpsStatus === 'idle' && ' '}
        </p>
      </div>
    </form>
  );
}
