// Subaccount tree ordering: within a rollup group the picker must show the
// section header first, then top-level categories A→Z, each immediately
// followed by its own subaccounts — and a subaccount whose parent vanished
// (archived) must still appear rather than being silently dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAccountingAccountOptions } from './account-options';

const rows = [
  { id: 'h', name: 'Operating Expense', rollupGroup: 'opex' as const, parentId: null },
  { id: 'b', name: 'Bank Fees', rollupGroup: 'opex' as const, parentId: 'h' },
  { id: 'a', name: 'Accounting', rollupGroup: 'opex' as const, parentId: 'h' },
  { id: 'z', name: 'ZZ Sub', rollupGroup: 'opex' as const, parentId: 'a' },
  { id: 'i', name: 'Income', rollupGroup: 'income' as const, parentId: null },
  { id: 'r', name: 'Roofing Revenue', rollupGroup: 'income' as const, parentId: 'i' },
];

test('subaccounts tuck directly under their parent, flagged isSub', () => {
  const opex = toAccountingAccountOptions(rows).filter((o) => o.rollupGroup === 'opex');
  assert.deepEqual(
    opex.map((o) => o.name),
    ['Operating Expense', 'Accounting', 'ZZ Sub', 'Bank Fees'],
  );
  assert.deepEqual(
    opex.map((o) => !!o.isSub),
    [false, false, true, false],
  );
  assert.equal(opex[0].isHeader, true);
});

test('standalone parentless leaf stays pickable, not a header', () => {
  const out = toAccountingAccountOptions([
    { id: 'v', name: 'VAT Input', rollupGroup: 'vat_tax' as const, parentId: null },
  ]);
  assert.equal(out[0].isHeader, false);
  assert.equal(!!out[0].isSub, false);
});

test('sub with archived parent still appears at end of group', () => {
  const out = toAccountingAccountOptions([
    ...rows,
    { id: 'p', name: 'Archived Parent', rollupGroup: 'opex' as const, parentId: 'h', isArchived: true },
    { id: 'orph', name: 'AA Orphan Sub', rollupGroup: 'opex' as const, parentId: 'p' },
  ]);
  const names = out.filter((o) => o.rollupGroup === 'opex').map((o) => o.name);
  assert.deepEqual(names, [
    'Operating Expense',
    'Accounting',
    'ZZ Sub',
    'Bank Fees',
    'AA Orphan Sub',
  ]);
});
