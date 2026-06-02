'use server';

// Field-app server actions.
//
// Punch in / punch out enforce two safety properties at the action layer:
//
//   1. The active user MUST be linked to an employee record. Without
//      that link, we can't attribute the punch — bail out with a friendly
//      error rather than writing a NULL-employee row.
//
//   2. You can't punch in twice in a row (or out twice). The "last
//      event" tells us the current state; if it disagrees with the
//      requested action we refuse. This guards against double-tap on
//      flaky cell signal — the worker presses the button twice while
//      the first request is still flying, and we'd otherwise log two
//      back-to-back in events.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { getCurrentUser } from '@/lib/auth';
import {
  getLatestClockEvent,
  markPunchesReviewed,
  postSessionsToTimeEntries,
  recordClockEvent,
} from '@/lib/data/clock-events';
import { getCompany } from '@/lib/data/companies';
import { formatTimeInTZ } from '@/lib/tz';

export type PunchState = {
  ok?: boolean;
  formError?: string;
};

// GPS coords arrive from the browser as strings (form data). The Geolocation
// API returns numbers but the hidden form fields stringify them. We accept
// blanks as "no signal" — never block a punch on missing location.
const punchSchema = z.object({
  projectId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  costCodeId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: z.string().max(500).optional().or(z.literal('')),
  gpsLat: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  gpsLng: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  gpsAccuracyM: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

async function commonPreflight(): Promise<
  | { ok: true; companyId: string; employeeId: string }
  | { ok: false; error: string }
> {
  const employee = await getActiveEmployee();
  if (!employee) {
    return {
      ok: false,
      error:
        'Your account is not linked to an employee record. Ask your administrator to link it on the Invite Users page.',
    };
  }
  const companyId = await getActiveCompanyId();
  return { ok: true, companyId, employeeId: employee.id };
}

function normGps(s: string | undefined): string | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}

export async function punchInAction(
  _prev: PunchState,
  formData: FormData,
): Promise<PunchState> {
  const pre = await commonPreflight();
  if (!pre.ok) return { formError: pre.error };

  const parsed = punchSchema.safeParse({
    projectId: formData.get('projectId') ?? '',
    costCodeId: formData.get('costCodeId') ?? '',
    notes: formData.get('notes') ?? '',
    gpsLat: formData.get('gpsLat') ?? '',
    gpsLng: formData.get('gpsLng') ?? '',
    gpsAccuracyM: formData.get('gpsAccuracyM') ?? '',
  });
  if (!parsed.success) {
    return { formError: 'Invalid punch data. Please reload and try again.' };
  }

  // A job is required to clock IN — otherwise the time lands as overhead
  // and someone has to recode it later on /clock. Enforced here (not just
  // in the UI) because the field Select renders its required flag on a
  // hidden input, which browsers skip during constraint validation.
  if (!parsed.data.projectId) {
    return {
      formError:
        'Pick the job you’re working on before you clock in. If you’re not on a specific job, ask your supervisor which to use.',
    };
  }

  // Refuse to log an "in" if the latest event is already "in" — that
  // would create back-to-back ins (almost always a double-tap).
  const last = await getLatestClockEvent(pre.employeeId);
  if (last?.kind === 'in') {
    return {
      formError: `You're already clocked in (since ${formatTimeInTZ(last.occurredAt)}). Tap "Clock out" first if you meant to start a new session.`,
    };
  }

  await recordClockEvent({
    companyId: pre.companyId,
    employeeId: pre.employeeId,
    projectId: parsed.data.projectId ?? null,
    costCodeId: parsed.data.costCodeId ?? null,
    kind: 'in',
    occurredAt: new Date(),
    gpsLat: normGps(parsed.data.gpsLat),
    gpsLng: normGps(parsed.data.gpsLng),
    gpsAccuracyM: normGps(parsed.data.gpsAccuracyM),
    notes: parsed.data.notes?.trim() || null,
  });

  revalidatePath('/field');
  revalidatePath('/field/clock');
  return { ok: true };
}

export async function punchOutAction(
  _prev: PunchState,
  formData: FormData,
): Promise<PunchState> {
  const pre = await commonPreflight();
  if (!pre.ok) return { formError: pre.error };

  const parsed = punchSchema.safeParse({
    projectId: formData.get('projectId') ?? '',
    costCodeId: formData.get('costCodeId') ?? '',
    notes: formData.get('notes') ?? '',
    gpsLat: formData.get('gpsLat') ?? '',
    gpsLng: formData.get('gpsLng') ?? '',
    gpsAccuracyM: formData.get('gpsAccuracyM') ?? '',
  });
  if (!parsed.success) {
    return { formError: 'Invalid punch data. Please reload and try again.' };
  }

  const last = await getLatestClockEvent(pre.employeeId);
  if (!last || last.kind !== 'in') {
    return {
      formError:
        "You're not currently clocked in. Tap \"Clock in\" to start a session.",
    };
  }

  const outEvent = await recordClockEvent({
    companyId: pre.companyId,
    employeeId: pre.employeeId,
    // Carry the open session's project forward if the client didn't send
    // one — most punches are "I'm done with what I was doing", not
    // switching jobs.
    projectId: parsed.data.projectId ?? last.projectId,
    costCodeId: parsed.data.costCodeId ?? last.costCodeId,
    kind: 'out',
    occurredAt: new Date(),
    gpsLat: normGps(parsed.data.gpsLat),
    gpsLng: normGps(parsed.data.gpsLng),
    gpsAccuracyM: normGps(parsed.data.gpsAccuracyM),
    notes: parsed.data.notes?.trim() || null,
  });

  // Phase M6.3: if the company has auto-post enabled, mark this
  // session reviewed (by the worker) and post it to time_entries
  // immediately. Wrapped in try/catch — auto-post is best-effort, the
  // punch itself MUST succeed even if the bridge fails.
  try {
    const company = await getCompany(pre.companyId);
    if (company?.autoPostClockSessions) {
      const user = await getCurrentUser();
      if (user) {
        await markPunchesReviewed(
          pre.companyId,
          [last.id, outEvent.id],
          user.id,
        );
        await postSessionsToTimeEntries(pre.companyId, [
          { in: last, out: outEvent },
        ]);
      }
    }
  } catch {
    // Don't surface auto-post failures to the worker — the punch
    // recorded fine, the admin can post manually from /clock.
  }

  revalidatePath('/field');
  revalidatePath('/field/clock');
  revalidatePath('/clock');
  return { ok: true };
}
