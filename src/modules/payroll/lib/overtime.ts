// Bahamian overtime tiers for hourly pay, computed from per-day PAID hours
// (already net of unpaid lunch). Rules (confirmed with the operator):
//   - Over 40 hours in the week  → time and a half (1.5×).
//   - Sunday, when Mon–Sat were ALL worked → double time (2×).
//   - A Bahamas public holiday worked → double time (2×).
//   - Overlaps cap at 2× (a holiday-Sunday is counted once as double).
//
// Double-time days (holiday / qualifying Sunday) are premium and sit OUTSIDE
// the 40-hour regular/OT split, so they aren't also counted toward overtime.

import { weekDates } from './periods';

export type OvertimeBreakdown = {
  /** Hours paid at 1×. */
  regularHours: number;
  /** Hours paid at 1.5× (over 40 regular). */
  overtimeHours: number;
  /** Hours paid at 2× (holiday + qualifying Sunday). */
  doubleTimeHours: number;
  gross: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeHourlyOvertime(
  netHoursByDay: Map<string, number>,
  weekStart: string,
  holidays: Set<string>,
  rate: number,
): OvertimeBreakdown {
  const dates = weekDates(weekStart); // Monday … Sunday
  const sunday = dates[6];
  const workedAllMonSat = dates
    .slice(0, 6)
    .every((d) => (netHoursByDay.get(d) ?? 0) > 0);

  let regularPool = 0;
  let doubleTimeHours = 0;
  for (const [date, hrs] of netHoursByDay) {
    if (hrs <= 0) continue;
    if (holidays.has(date)) {
      doubleTimeHours += hrs; // holiday → 2× (takes precedence over Sunday)
    } else if (date === sunday && workedAllMonSat) {
      doubleTimeHours += hrs; // Sunday after a full Mon–Sat → 2×
    } else {
      regularPool += hrs;
    }
  }
  regularPool = round2(regularPool);
  doubleTimeHours = round2(doubleTimeHours);

  const regularHours = round2(Math.min(regularPool, 40));
  const overtimeHours = round2(Math.max(0, regularPool - 40));
  const gross = round2(
    regularHours * rate + overtimeHours * rate * 1.5 + doubleTimeHours * rate * 2,
  );
  return { regularHours, overtimeHours, doubleTimeHours, gross };
}
