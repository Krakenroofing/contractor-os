// Landed-cost calculation tests. Run with: npm test
//
// Pure function (no DB/network) → Node's built-in runner via tsx. These lock
// the Bahamas Customs Processing Fee behaviour (1% of goods value, capped at
// $1,000) and the VAT base, calibrated against real Pinder's import summaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLandedCost } from './money';

// Helper: a bare input with everything zeroed except what a test sets.
function input(over: Partial<Parameters<typeof calcLandedCost>[0]> = {}) {
  return {
    quantity: 1,
    unitCost: 0,
    flDelivery: 0,
    crating: 0,
    freightCost: 0,
    insurance: 0,
    dutyPercent: 0,
    vatPercent: 10,
    envLevyPercent: 0,
    excisePercent: 0,
    brokerage: 0,
    portFees: 0,
    localDelivery: 0,
    ...over,
  };
}

test('processing fee is 1% of goods value by default', () => {
  const t = calcLandedCost(input({ quantity: 1, unitCost: 10000 }));
  assert.equal(t.processingFee, 100); // 1% of 10,000
});

test('processing fee is capped at $1,000', () => {
  // 1% of 102,760.78 = 1,027.61 → capped at 1,000 (real shipment 1020240).
  const t = calcLandedCost(input({ quantity: 1, unitCost: 102760.78 }));
  assert.equal(t.processingFee, 1000);
});

test('processing fee is 1% of VALUE, not CIF (freight is excluded)', () => {
  const t = calcLandedCost(
    input({ quantity: 1, unitCost: 10000, freightCost: 5000 }),
  );
  assert.equal(t.processingFee, 100); // still 1% of the 10,000 value
});

test('VAT base includes the processing fee', () => {
  // value 10,000, freight 0, duty 0 → CIF 10,000, processing 100.
  // VAT base = 10,000 + 100 = 10,100 → VAT @10% = 1,010.
  const t = calcLandedCost(input({ quantity: 1, unitCost: 10000 }));
  assert.equal(t.vatBase, 10100);
  assert.equal(t.vat, 1010);
});

test('reconciles the DensDeck shipment (1012483) gross landed cost', () => {
  // Real doc: value 24,515.70, freight 8,293.10, duty 0%, VAT 10%.
  // Broker "landed cost" (excl VAT) = CIF + processing = 33,053.95.
  // App total is GROSS (incl VAT) per the chosen treatment.
  const t = calcLandedCost(
    input({ quantity: 1, unitCost: 24515.7, freightCost: 8293.1 }),
  );
  assert.equal(t.cif, 32808.8);
  assert.equal(t.processingFee, 245.16); // 1% of 24,515.70, rounded
  // CIF + processing = broker's landed-cost line (± a penny of rounding).
  assert.ok(Math.abs(t.cif + t.processingFee - 33053.95) < 0.05);
  // Gross total = broker landed cost + VAT.
  assert.ok(Math.abs(t.total - (t.cif + t.processingFee + t.vat)) < 0.01);
});

test('an override percent/cap is respected', () => {
  const t = calcLandedCost(
    input({
      quantity: 1,
      unitCost: 50000,
      processingFeePercent: 0,
      processingFeeCap: 0,
    }),
  );
  assert.equal(t.processingFee, 0);
});
