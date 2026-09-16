import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSubtractingLine, signUnitCost } from './line-signs';

test('deduction and project-credit rows subtract', () => {
  assert.equal(isSubtractingLine({ isDeduction: true }), true);
  assert.equal(isSubtractingLine({ isProjectCredit: true }), true);
  assert.equal(isSubtractingLine({}), false);
});

test('a plain amount typed on a deduction row is stored negative', () => {
  // Olga's case: "+ Add credit / deduction" then typing 318.20 must reduce
  // the invoice, not add to it.
  assert.equal(signUnitCost('318.20', true), '-318.20');
  assert.equal(signUnitCost('1,000', true), '-1,000');
});

test('an already-negative amount is left alone', () => {
  assert.equal(signUnitCost('-318.20', true), '-318.20');
  assert.equal(signUnitCost('0', true), '0');
});

test('partial typing passes through', () => {
  assert.equal(signUnitCost('', true), '');
  assert.equal(signUnitCost('-', true), '-');
  assert.equal(signUnitCost('abc', true), 'abc');
});

test('normal rows are untouched', () => {
  assert.equal(signUnitCost('318.20', false), '318.20');
  assert.equal(signUnitCost('-5', false), '-5');
});
