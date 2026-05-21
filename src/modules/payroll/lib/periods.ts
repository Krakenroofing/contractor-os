// Week math for payroll. Periods run Monday → Sunday (ISO week start).
// Dates throughout this module are 'YYYY-MM-DD' strings — the same format
// the DB stores and HTML <input type="date"> emits — to sidestep timezone
// shifts that would happen if we round-tripped through Date objects.

const ONE_DAY_MS = 86_400_000;

/** Parse 'YYYY-MM-DD' into a UTC Date at midnight. */
function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date as 'YYYY-MM-DD'. */
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Return the Monday on or before the given date (as 'YYYY-MM-DD'). UTC math
 * so DST and local timezone don't shift the answer.
 *
 * In JS getUTCDay(): Sunday=0, Monday=1, …, Saturday=6.
 * Subtract ((day + 6) % 7) days so Monday→0, Tuesday→1, …, Sunday→6.
 */
export function mondayOf(date: string): string {
  const d = parseISO(date);
  const day = d.getUTCDay();
  const back = (day + 6) % 7;
  return toISO(new Date(d.getTime() - back * ONE_DAY_MS));
}

/** Return the Sunday at the end of the week containing `date`. */
export function sundayOf(date: string): string {
  const mon = parseISO(mondayOf(date));
  return toISO(new Date(mon.getTime() + 6 * ONE_DAY_MS));
}

/** All seven dates of the week containing `date`, Monday first. */
export function weekDates(date: string): string[] {
  const start = parseISO(mondayOf(date));
  return Array.from({ length: 7 }, (_, i) =>
    toISO(new Date(start.getTime() + i * ONE_DAY_MS)),
  );
}

/** Add `days` to an ISO date string. */
export function addDays(date: string, days: number): string {
  return toISO(new Date(parseISO(date).getTime() + days * ONE_DAY_MS));
}

/** Today as 'YYYY-MM-DD' in UTC. Avoids local-timezone "yesterday" surprises. */
export function todayISO(): string {
  return toISO(new Date());
}

/** Short label for a week, e.g. "May 19 – 25, 2026". */
export function formatPeriodLabel(start: string, end: string): string {
  const s = parseISO(start);
  const e = parseISO(end);
  const monthShort = (d: Date) =>
    d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  if (sameMonth && sameYear) {
    return `${monthShort(s)} ${s.getUTCDate()} – ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${monthShort(s)} ${s.getUTCDate()} – ${monthShort(e)} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
  }
  return `${monthShort(s)} ${s.getUTCDate()}, ${s.getUTCFullYear()} – ${monthShort(e)} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

/** Day-of-week label, e.g. "Mon 19". */
export function formatDayLabel(date: string): string {
  const d = parseISO(date);
  const day = d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${day} ${d.getUTCDate()}`;
}
