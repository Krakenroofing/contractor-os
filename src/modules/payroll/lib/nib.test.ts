import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeeklyNib, nibCeilingForDate, NIB_RATES } from './nib';

test('NIB rates are 4.65% employee / 6.65% employer (Non-Hospitality C-10)', () => {
  assert.equal(NIB_RATES.employeeRate, 0.0465);
  assert.equal(NIB_RATES.employerRate, 0.0665);
});

test('insurable-wage ceiling rises $810 → $830 on 2026-07-01', () => {
  assert.equal(nibCeilingForDate('2026-06-30').weeklyWageCeiling, 810);
  assert.equal(nibCeilingForDate('2026-06-30').monthlyWageCeiling, 3510);
  assert.equal(nibCeilingForDate('2026-07-01').weeklyWageCeiling, 830);
  assert.equal(nibCeilingForDate('2026-07-01').monthlyWageCeiling, 3597);
  assert.equal(nibCeilingForDate('2026-12-01').weeklyWageCeiling, 830);
});

test('high earner capped at the date-appropriate ceiling', () => {
  // $1,000/week is above both ceilings → NIB on the cap only.
  const before = calculateWeeklyNib(1000, '2026-06-28');
  assert.equal(before.insurableWage, 810);
  assert.equal(before.employee, 37.67); // 810 × 4.65%
  assert.equal(before.employer, 53.87); // 810 × 6.65%

  const after = calculateWeeklyNib(1000, '2026-07-05');
  assert.equal(after.insurableWage, 830);
  assert.equal(after.employee, 38.6); // 830 × 4.65%
  assert.equal(after.employer, 55.2); // 830 × 6.65%
});

test('below the ceiling, NIB is on actual gross (ceiling date irrelevant)', () => {
  const a = calculateWeeklyNib(500, '2026-06-28');
  const b = calculateWeeklyNib(500, '2026-07-05');
  assert.equal(a.insurableWage, 500);
  assert.equal(b.insurableWage, 500);
  assert.deepEqual(a, b);
});

test('zero gross → zero NIB regardless of date', () => {
  assert.equal(calculateWeeklyNib(0, '2026-07-05').total, 0);
});
