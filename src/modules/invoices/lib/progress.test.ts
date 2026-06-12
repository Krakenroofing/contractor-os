// Progress-billing track math: a % draw on a CO-linked invoice bills
// against the CO's value and CO-track priors — never the project total.
// Regression suite for the "CO invoice still totals from the project"
// bug (2026-06-12).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProgressNumbers,
  resolveProgressSource,
} from './progress';

const project = {
  contractValue: 110_000, // revised (base + COs) — must NOT drive % math
  baseContractValue: 100_000,
  priorBilledGross: 30_000,
  priorBilledNet: 27_000,
  priorInvoiceCount: 2,
};

const co = {
  label: 'CO-2026-003',
  total: 10_000,
  priorBilledGross: 2_500,
  priorBilledNet: 2_250,
  priorInvoiceCount: 1,
};

test('linked CO bills against the CO value, not the project total', () => {
  const source = resolveProgressSource(co, project);
  assert.ok(source);
  assert.equal(source.kind, 'co');
  assert.equal(source.value, 10_000);

  const n = computeProgressNumbers(source, 50, 0);
  assert.ok(n);
  // 50% of the CO = $5,000 cumulative; $2,500 already billed on the CO
  // track → this round bills $2,500. If the project total leaked in, the
  // cumulative would be $55,000.
  assert.equal(n.cumulativeBilled, 5_000);
  assert.equal(n.thisRoundGross, 2_500);
  assert.equal(n.billingNumber, 2);
  assert.equal(n.sourceLabel, 'CO-2026-003');
});

test('CO priors are CO-track only — project priors never deduct', () => {
  const freshCo = { ...co, priorBilledGross: 0, priorBilledNet: 0, priorInvoiceCount: 0 };
  const n = computeProgressNumbers(
    resolveProgressSource(freshCo, project),
    25,
    0,
  );
  assert.ok(n);
  // 25% of $10k CO = $2,500 — the project's $30k prior billed is ignored.
  assert.equal(n.thisRoundGross, 2_500);
  assert.equal(n.billingNumber, 1);
});

test('no CO → base contract track with ORIGINAL contract value', () => {
  const source = resolveProgressSource(undefined, project);
  assert.ok(source);
  assert.equal(source.kind, 'base');
  // Original value, not the CO-revised 110k — % numbers must not reshape
  // after a CO gets approved.
  assert.equal(source.value, 100_000);

  const n = computeProgressNumbers(source, 40, 10);
  assert.ok(n);
  assert.equal(n.cumulativeBilled, 40_000);
  assert.equal(n.thisRoundGross, 10_000); // 40k − 30k base-track priors
  assert.equal(n.cumulativeRetention, 4_000); // 10% of cumulative
  assert.equal(n.billingNumber, 3);
});

test('zero-value CO does NOT fall back to the project total', () => {
  const source = resolveProgressSource({ label: 'CO-2026-009' }, project);
  assert.ok(source);
  assert.equal(source.kind, 'co');
  assert.equal(source.value, 0);
  // No silent project-total billing: math refuses to run.
  assert.equal(computeProgressNumbers(source, 50, 0), null);
});

test('this-round gross floors at zero when % is below prior billings', () => {
  const n = computeProgressNumbers(resolveProgressSource(co, project), 10, 0);
  assert.ok(n);
  // 10% of $10k = $1,000 cumulative, but $2,500 already billed → 0, never
  // negative.
  assert.equal(n.thisRoundGross, 0);
});

test('older callers without baseContractValue fall back to contractValue', () => {
  const source = resolveProgressSource(undefined, {
    contractValue: 50_000,
    priorBilledGross: 0,
    priorBilledNet: 0,
    priorInvoiceCount: 0,
  });
  assert.ok(source);
  assert.equal(source.value, 50_000);
});
