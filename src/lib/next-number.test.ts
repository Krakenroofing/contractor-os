import test from 'node:test';
import assert from 'node:assert/strict';
import { nextNumberInSequence } from './next-number';

test('plain numeric sequence increments', () => {
  const rows = [
    { number: '1039', createdAt: '2026-08-18' },
    { number: '1038', createdAt: '2026-06-07' },
  ];
  assert.equal(nextNumberInSequence(rows, 'X-001'), '1040');
});

test('follows most recent series, not all-time max', () => {
  const rows = [
    { number: '10655', createdAt: '2025-06-05' },
    { number: '2712', createdAt: '2025-11-12' },
    { number: '6071', createdAt: '2026-08-18' },
  ];
  assert.equal(nextNumberInSequence(rows, 'X-001'), '6072');
});

test('bumps past taken numbers (void + reissue)', () => {
  const rows = [
    { number: '1040', createdAt: '2026-08-14' },
    { number: '1039', createdAt: '2026-08-18' }, // reissued after void, newest
  ];
  assert.equal(nextNumberInSequence(rows, 'X-001'), '1041');
});

test('preserves prefix and zero padding', () => {
  assert.equal(
    nextNumberInSequence([{ number: 'PO018', createdAt: '2026-07-06' }], 'X'),
    'PO019',
  );
  assert.equal(
    nextNumberInSequence([{ number: 'CM-2026-009', createdAt: '2026-07-06' }], 'X'),
    'CM-2026-010',
  );
  assert.equal(nextNumberInSequence([{ number: 'PO999', createdAt: '2026-07-06' }], 'X'), 'PO1000');
});

test('ignores " (2)" copy suffixes', () => {
  const rows = [
    { number: '6023 (2)', createdAt: '2026-07-01' },
    { number: '6023', createdAt: '2026-04-01' },
  ];
  assert.equal(nextNumberInSequence(rows, 'X-001'), '6024');
});

test('skips numbers without trailing digits', () => {
  const rows = [
    { number: 'WW-EGW', createdAt: '2026-08-01' },
    { number: 'BC-CO2', createdAt: '2026-07-01' },
  ];
  assert.equal(nextNumberInSequence(rows, 'X-001'), 'BC-CO3');
});

test('falls back when nothing usable exists', () => {
  assert.equal(nextNumberInSequence([], 'INV-2026-001'), 'INV-2026-001');
  assert.equal(
    nextNumberInSequence([{ number: 'DRAFT' }], 'INV-2026-001'),
    'INV-2026-001',
  );
});

test('rows without createdAt still work', () => {
  assert.equal(nextNumberInSequence([{ number: '1001' }], 'X'), '1002');
});
