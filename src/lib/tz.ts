// =====================================================================
// App timezone
//
// Kraken Roofing operates in the Bahamas (AST, UTC-4, no DST). On Vercel
// the server process runs in UTC, so any code that reaches for "today"
// via `setHours(0,0,0,0)` or `new Date().getMonth()` is wrong for ~4 hrs
// every evening (8 PM – midnight Nassau = next-day UTC).
//
// Route all "what day is it for the business?" questions through here.
// Pure UTC math is still fine for things that *are* genuinely UTC-anchored
// (e.g. payroll period boundaries that the DB stores as ISO date strings).
// =====================================================================

export const APP_TZ = process.env.APP_TZ ?? 'America/Nassau';

type WallClockParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallClockParts(date: Date, tz: string): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') lookup[p.type] = p.value;
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

// Minutes that `tz` differs from UTC at the given instant. Nassau = -240.
// Computed by re-interpreting the tz wall clock as if it were UTC and
// diffing against the real instant — avoids hard-coding the offset.
function tzOffsetMinutes(date: Date, tz: string): number {
  const w = wallClockParts(date, tz);
  const asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * The absolute instant of 00:00:00 on the calendar day that `now` falls on
 * in `tz`. On Vercel, prefer this over `setHours(0,0,0,0)` for any
 * "today's events" query — otherwise you bucket by UTC midnight.
 */
export function startOfDayInTZ(now: Date = new Date(), tz: string = APP_TZ): Date {
  const { year, month, day } = wallClockParts(now, tz);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = tzOffsetMinutes(new Date(utcGuess), tz);
  return new Date(utcGuess - offset * 60000);
}

/** The absolute instant of 23:59:59.999 on the calendar day of `now` in `tz`. */
export function endOfDayInTZ(now: Date = new Date(), tz: string = APP_TZ): Date {
  const { year, month, day } = wallClockParts(now, tz);
  const utcGuess = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const offset = tzOffsetMinutes(new Date(utcGuess), tz);
  return new Date(utcGuess - offset * 60000);
}

/** 'YYYY-MM-DD' for the calendar day that `now` falls on in `tz`. */
export function todayISOInTZ(now: Date = new Date(), tz: string = APP_TZ): string {
  const { year, month, day } = wallClockParts(now, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Format a Date as 'YYYY-MM-DDTHH:mm' wall-clock in `tz`, suitable for
 * pre-filling <input type="datetime-local">. The form posts back the
 * same wall-clock string, which `parseDateTimeLocalInTZ` re-anchors to
 * an absolute instant — round-trip preserves what the user sees.
 */
export function formatDateTimeLocalInTZ(
  d: Date,
  tz: string = APP_TZ,
): string {
  const w = wallClockParts(d, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * Parse 'YYYY-MM-DDTHH:mm' (or with :ss) as wall-clock time in `tz`,
 * returning the absolute instant. Throws on invalid input — callers
 * should pre-validate with a regex first.
 */
export function parseDateTimeLocalInTZ(
  s: string,
  tz: string = APP_TZ,
): Date {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) throw new Error(`Invalid datetime-local string: ${s}`);
  const [, y, mo, d, h, mi, se] = m;
  const utcGuess = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se ?? '0'),
  );
  const offset = tzOffsetMinutes(new Date(utcGuess), tz);
  return new Date(utcGuess - offset * 60000);
}
