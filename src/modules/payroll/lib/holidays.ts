// Bahamas public holidays, computed per year. Used by the overtime engine —
// hours worked on one of these days are paid at double time.
//
// Movable feasts use the Gregorian computus for Easter; the rest are fixed
// dates or the Nth weekday of a month. Dates are 'YYYY-MM-DD' (UTC), matching
// the rest of the payroll date math. NOTE: this is the calendar date of each
// holiday — government "observed" shifting (e.g. a Sunday holiday taken the
// following Monday) is NOT applied here; adjust the list if the gazette differs.

import { addDays } from './periods';

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** Easter Sunday (Gregorian) as 'YYYY-MM-DD' — Anonymous Gregorian algorithm. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** The Nth (1-based) given weekday of a month. weekday: 0=Sun … 6=Sat. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
  return iso(year, month, day);
}

/** All Bahamas public holidays for a calendar year, as ISO date strings. */
export function bahamasHolidays(year: number): string[] {
  const easter = easterSunday(year);
  return [
    iso(year, 1, 1), // New Year's Day
    iso(year, 1, 10), // Majority Rule Day
    addDays(easter, -2), // Good Friday
    addDays(easter, 1), // Easter Monday
    addDays(easter, 50), // Whit Monday
    nthWeekday(year, 6, 5, 1), // Randol Fawkes Labour Day — 1st Friday of June
    iso(year, 7, 10), // Independence Day
    nthWeekday(year, 8, 1, 1), // Emancipation Day — 1st Monday of August
    nthWeekday(year, 10, 1, 2), // National Heroes Day — 2nd Monday of October
    iso(year, 12, 25), // Christmas Day
    iso(year, 12, 26), // Boxing Day
  ];
}

/** A set of holiday dates spanning the given years (a pay week can cross a
 *  year boundary, so callers pass both the start and end year). */
export function bahamasHolidaySet(years: number[]): Set<string> {
  const set = new Set<string>();
  for (const y of years) for (const d of bahamasHolidays(y)) set.add(d);
  return set;
}
