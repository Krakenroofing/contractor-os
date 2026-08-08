// Manual-VAT override semantics: typing the VAT amount must keep the
// operator's net / gross anchors (customs receipts compute VAT on a
// different base than the invoice net), and a consistent triplet must
// survive the server-side 'init' recompute round-trip unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVat } from './vat';

test('typing VAT keeps the gross when VAT-included (customs override)', () => {
  // Gross 225.06 was typed first; the true customs VAT is 37.71, not 10%.
  const out = computeVat({
    subtotal: 204.6,
    vatAmount: 37.71,
    total: 225.06,
    vatRatePercent: 10,
    vatIncluded: true,
    driver: 'vatAmount',
  });
  assert.equal(out.total, 225.06); // gross untouched
  assert.equal(out.vatAmount, 37.71); // typed VAT kept
  assert.equal(out.subtotal, 187.35); // net absorbs the difference
});

test('typing VAT keeps the net when VAT-excluded', () => {
  const out = computeVat({
    subtotal: 204.6,
    vatAmount: 37.71,
    total: 225.06,
    vatRatePercent: 10,
    vatIncluded: false,
    driver: 'vatAmount',
  });
  assert.equal(out.subtotal, 204.6); // net untouched
  assert.equal(out.vatAmount, 37.71);
  assert.equal(out.total, 242.31); // gross = net + vat
});

test('typing VAT with only VAT known still derives from the rate', () => {
  const out = computeVat({
    vatAmount: 10,
    vatRatePercent: 10,
    vatIncluded: true,
    driver: 'vatAmount',
  });
  assert.equal(out.subtotal, 100);
  assert.equal(out.total, 110);
});

test('a consistent off-rate triplet survives init (server round-trip)', () => {
  // net + vat = gross exactly, but vat is NOT 10% of net — manual override
  // saved earlier. Server 'init' must not re-derive it.
  const out = computeVat({
    subtotal: 187.35,
    vatAmount: 37.71,
    total: 225.06,
    vatRatePercent: 10,
    vatIncluded: true,
    driver: 'init',
  });
  assert.equal(out.subtotal, 187.35);
  assert.equal(out.vatAmount, 37.71);
  assert.equal(out.total, 225.06);
});

test('an inconsistent triplet is still normalized from the rate on init', () => {
  // Drifted client state: numbers do not add up — old behavior applies.
  const out = computeVat({
    subtotal: 100,
    vatAmount: 5,
    total: 225.06,
    vatRatePercent: 10,
    vatIncluded: true,
    driver: 'init',
  });
  assert.equal(out.total, 225.06);
  assert.equal(out.subtotal, 204.6);
  assert.equal(out.vatAmount, 20.46);
});

test('zero-VAT line stays zero through init', () => {
  const out = computeVat({
    subtotal: 204.54,
    vatAmount: 0,
    total: 204.54,
    vatRatePercent: 10,
    vatIncluded: true,
    driver: 'init',
  });
  assert.equal(out.subtotal, 204.54);
  assert.equal(out.vatAmount, 0);
  assert.equal(out.total, 204.54);
});

test('total driver still splits gross by the rate', () => {
  const out = computeVat({
    total: 110,
    vatRatePercent: 10,
    vatIncluded: true,
    driver: 'total',
  });
  assert.equal(out.subtotal, 100);
  assert.equal(out.vatAmount, 10);
});
