// Timezone helper tests. Run with: npm test
//
// These are pure functions (no DB, no network), so they run under Node's
// built-in test runner via tsx — no extra dependency. They are the real
// regression guard for the "7:30 AM punch shows as 11:30 AM" bug: that
// bug only reproduces when the *runtime* timezone is UTC (as on Vercel),
// which a local dev machine in another zone wouldn't surface. To make the
// test deterministic regardless of the machine it runs on, we force the
// process timezone to UTC below — the same condition production runs in.

process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimeInTZ,
  formatDateLongInTZ,
  todayISOInTZ,
  startOfDayInTZ,
  endOfDayInTZ,
  parseDateTimeLocalInTZ,
  formatDateTimeLocalInTZ,
} from './tz';

const NASSAU = 'America/Nassau';

// ---------------------------------------------------------------------------
// The reported bug: a 7:30 AM Nassau punch was showing as 11:30 AM.
// In summer (EDT) Nassau is UTC-4, so 7:30 local is stored as 11:30Z.
// The display must convert that stored instant BACK to Nassau → "7:30 AM".
// ---------------------------------------------------------------------------

test('7:30 AM Nassau punch (summer) displays as 7:30 AM, not 11:30 AM', () => {
  // What the DB holds for a 7:30 AM 2026-06-02 (EDT) punch: 11:30:00Z.
  const stored = new Date('2026-06-02T11:30:00.000Z');
  assert.equal(formatTimeInTZ(stored, NASSAU), '7:30 AM');
});

test('the stored UTC instant for a 7:30 AM Nassau punch is 11:30Z (summer)', () => {
  const instant = parseDateTimeLocalInTZ('2026-06-02T07:30', NASSAU);
  assert.equal(instant.toISOString(), '2026-06-02T11:30:00.000Z');
});

test('formatting in UTC (the bug) would have shown 11:30 — proving the regression', () => {
  const stored = new Date('2026-06-02T11:30:00.000Z');
  // This is what the old `toLocaleTimeString(undefined,…)` did on Vercel.
  const buggy = stored.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  assert.equal(buggy, '11:30 AM');
  assert.notEqual(formatTimeInTZ(stored, NASSAU), buggy);
});

// ---------------------------------------------------------------------------
// Daylight saving time. The Bahamas observes DST (contrary to the old
// "AST, UTC-4, no DST" comment): EST/UTC-5 in winter, EDT/UTC-4 in summer.
// The Intl-based helpers must pick the right offset for the given instant.
// ---------------------------------------------------------------------------

test('winter punch uses EST (UTC-5): 7:30 AM Nassau is stored as 12:30Z', () => {
  const instant = parseDateTimeLocalInTZ('2026-01-15T07:30', NASSAU);
  assert.equal(instant.toISOString(), '2026-01-15T12:30:00.000Z');
});

test('a 12:30Z winter instant displays as 7:30 AM Nassau (EST)', () => {
  const stored = new Date('2026-01-15T12:30:00.000Z');
  assert.equal(formatTimeInTZ(stored, NASSAU), '7:30 AM');
});

test('the same wall-clock time maps to different UTC instants across DST', () => {
  const summer = parseDateTimeLocalInTZ('2026-06-02T07:30', NASSAU);
  const winter = parseDateTimeLocalInTZ('2026-01-15T07:30', NASSAU);
  // One hour apart in UTC because the offset differs (UTC-4 vs UTC-5).
  const diffHours =
    (winter.getUTCHours() - summer.getUTCHours() + 24) % 24;
  assert.equal(diffHours, 1);
});

// ---------------------------------------------------------------------------
// "Today" must roll over at Nassau midnight, not UTC midnight. The classic
// failure: 8 PM–midnight Nassau is already "tomorrow" in UTC.
// ---------------------------------------------------------------------------

test('9 PM Nassau (EDT) still reports today, not tomorrow', () => {
  // 2026-06-02 21:00 EDT = 2026-06-03 01:00Z. UTC date is the 3rd; Nassau
  // date is still the 2nd.
  const instant = new Date('2026-06-03T01:00:00.000Z');
  assert.equal(todayISOInTZ(instant, NASSAU), '2026-06-02');
});

test('startOfDayInTZ / endOfDayInTZ bracket the Nassau calendar day', () => {
  const ref = new Date('2026-06-02T15:00:00.000Z'); // 11 AM EDT
  const start = startOfDayInTZ(ref, NASSAU);
  const end = endOfDayInTZ(ref, NASSAU);
  // Midnight EDT = 04:00Z; end-of-day = next 03:59:59.999Z.
  assert.equal(start.toISOString(), '2026-06-02T04:00:00.000Z');
  assert.equal(end.toISOString(), '2026-06-03T03:59:59.999Z');
  // A 9 PM Nassau punch (01:00Z next day) falls inside the window.
  const evening = new Date('2026-06-03T01:00:00.000Z');
  assert.ok(evening >= start && evening <= end);
});

// ---------------------------------------------------------------------------
// Round-trip: edit form pre-fills a wall-clock string, posts it back, and
// the action re-anchors it. The instant the user sees must be preserved.
// ---------------------------------------------------------------------------

test('format → parse round-trips the same instant (summer)', () => {
  const original = new Date('2026-06-02T11:30:00.000Z');
  const local = formatDateTimeLocalInTZ(original, NASSAU);
  assert.equal(local, '2026-06-02T07:30');
  const back = parseDateTimeLocalInTZ(local, NASSAU);
  assert.equal(back.toISOString(), original.toISOString());
});

test('format → parse round-trips across the winter offset too', () => {
  const original = new Date('2026-01-15T12:30:00.000Z');
  const local = formatDateTimeLocalInTZ(original, NASSAU);
  assert.equal(local, '2026-01-15T07:30');
  const back = parseDateTimeLocalInTZ(local, NASSAU);
  assert.equal(back.toISOString(), original.toISOString());
});

// ---------------------------------------------------------------------------
// Duration math is timezone-independent (it's just instant subtraction),
// but the audit asks us to prove it — including an overnight shift.
// ---------------------------------------------------------------------------

test('an 8-hour day shift computes 8.00 hours', () => {
  const inAt = parseDateTimeLocalInTZ('2026-06-02T07:30', NASSAU);
  const outAt = parseDateTimeLocalInTZ('2026-06-02T15:30', NASSAU);
  const hours = (outAt.getTime() - inAt.getTime()) / 3_600_000;
  assert.equal(hours, 8);
});

test('an overnight shift across Nassau midnight computes the right span', () => {
  // 10 PM to 6 AM next day = 8 hours, even though the calendar day flips.
  const inAt = parseDateTimeLocalInTZ('2026-06-02T22:00', NASSAU);
  const outAt = parseDateTimeLocalInTZ('2026-06-03T06:00', NASSAU);
  const hours = (outAt.getTime() - inAt.getTime()) / 3_600_000;
  assert.equal(hours, 8);
  // The IN punch anchors the work day → 2026-06-02.
  assert.equal(todayISOInTZ(inAt, NASSAU), '2026-06-02');
});

test('formatDateLongInTZ labels the Nassau calendar day', () => {
  // 01:00Z on the 3rd is still the evening of the 2nd in Nassau.
  const evening = new Date('2026-06-03T01:00:00.000Z');
  assert.equal(
    formatDateLongInTZ(evening, NASSAU),
    'Tuesday, June 2, 2026',
  );
});
