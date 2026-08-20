// Bahamian overtime tiers + the 2026 holiday dates that drive double time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHourlyOvertime } from './overtime';
import { bahamasHolidays, bahamasHolidaySet } from './holidays';

// Week of Mon 2026-06-01 … Sun 2026-06-07.
const MON = '2026-06-01';
const week = (m: Record<string, number>) => new Map(Object.entries(m));

test('under 40h: all regular, no premium', () => {
  const r = computeHourlyOvertime(
    week({ '2026-06-01': 8, '2026-06-02': 8, '2026-06-03': 8 }),
    MON,
    new Set(),
    20,
  );
  assert.equal(r.regularHours, 24);
  assert.equal(r.overtimeHours, 0);
  assert.equal(r.doubleTimeHours, 0);
  assert.equal(r.gross, 480);
});

test('over 40h: excess is 1.5x', () => {
  // 5 × 9h = 45h regular.
  const r = computeHourlyOvertime(
    week({
      '2026-06-01': 9,
      '2026-06-02': 9,
      '2026-06-03': 9,
      '2026-06-04': 9,
      '2026-06-05': 9,
    }),
    MON,
    new Set(),
    20,
  );
  assert.equal(r.regularHours, 40);
  assert.equal(r.overtimeHours, 5);
  // 40*20 + 5*20*1.5 = 800 + 150 = 950.
  assert.equal(r.gross, 950);

  // Per-day attribution is chronological: Mon–Thu are all straight time
  // (36h pool), Friday splits 4h straight + 5h OT once the pool crosses 40.
  assert.equal(r.days.length, 5);
  assert.deepEqual(r.days[3], {
    date: '2026-06-04',
    hours: 9,
    regular: 9,
    overtime: 0,
    doubleTime: 0,
  });
  assert.deepEqual(r.days[4], {
    date: '2026-06-05',
    hours: 9,
    regular: 4,
    overtime: 5,
    doubleTime: 0,
  });
});

test('Sunday is 2x only when Mon–Sat were all worked', () => {
  const base = {
    '2026-06-01': 8,
    '2026-06-02': 8,
    '2026-06-03': 8,
    '2026-06-04': 8,
    '2026-06-05': 8,
    '2026-06-06': 8, // Sat
    '2026-06-07': 5, // Sun
  };
  const full = computeHourlyOvertime(week(base), MON, new Set(), 20);
  assert.equal(full.doubleTimeHours, 5); // Sunday at 2x
  // Mon–Sat = 48h regular pool → 40 reg + 8 OT; + 5h Sun @2x.
  assert.equal(full.regularHours, 40);
  assert.equal(full.overtimeHours, 8);
  assert.equal(full.gross, 800 + 8 * 30 + 5 * 40); // 800+240+200 = 1240
  // The Sunday day-line is pure double time; Saturday carries the 8h OT
  // (pool hits 40 at end of Friday).
  assert.deepEqual(full.days[6], {
    date: '2026-06-07',
    hours: 5,
    regular: 0,
    overtime: 0,
    doubleTime: 5,
  });
  assert.deepEqual(full.days[5], {
    date: '2026-06-06',
    hours: 8,
    regular: 0,
    overtime: 8,
    doubleTime: 0,
  });

  // Skip Saturday → Sunday no longer qualifies, counts as regular.
  const noSat = { ...base };
  delete (noSat as Record<string, number>)['2026-06-06'];
  const partial = computeHourlyOvertime(week(noSat), MON, new Set(), 20);
  assert.equal(partial.doubleTimeHours, 0);
});

test('a worked holiday is 2x and outside the 40h split', () => {
  // Randol Fawkes Labour Day 2026 = Fri 2026-06-05.
  const holidays = bahamasHolidaySet([2026]);
  assert.ok(holidays.has('2026-06-05'));
  const r = computeHourlyOvertime(
    week({
      '2026-06-01': 8,
      '2026-06-02': 8,
      '2026-06-03': 8,
      '2026-06-04': 8,
      '2026-06-05': 8, // holiday
    }),
    MON,
    holidays,
    20,
  );
  assert.equal(r.doubleTimeHours, 8);
  assert.equal(r.regularHours, 32); // the other four days
  assert.equal(r.overtimeHours, 0);
  assert.equal(r.gross, 32 * 20 + 8 * 40); // 640 + 320 = 960
});

test('2026 Bahamas holidays resolve to the expected dates', () => {
  const h = bahamasHolidays(2026);
  assert.ok(h.includes('2026-01-01')); // New Year's
  assert.ok(h.includes('2026-01-10')); // Majority Rule
  assert.ok(h.includes('2026-04-03')); // Good Friday (Easter 2026 = Apr 5)
  assert.ok(h.includes('2026-04-06')); // Easter Monday
  assert.ok(h.includes('2026-07-10')); // Independence
  assert.ok(h.includes('2026-12-25')); // Christmas
  assert.ok(h.includes('2026-12-26')); // Boxing Day
});
