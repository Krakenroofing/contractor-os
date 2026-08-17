// Statement-import mapping: a blank description must NOT reject a row that
// has a valid date and amount (banks leave it empty on card fees / small
// charges — the Keidelle CSV had 8 such rows). Bad dates still error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMapping, type Mapping } from './mapping';

const MAPPING: Mapping = {
  columnMap: {
    date: 'Date',
    description: 'Description',
    debit: 'Debit Amount',
    credit: 'Credit Amount',
  },
  dateFormat: 'MM/DD/YYYY',
  amountStrategy: 'debit_credit_split',
  decimalSeparator: '.',
  thousandsSeparator: ',',
  skipRows: 0,
};

test('blank description imports with a placeholder, not an error', () => {
  const res = applyMapping(
    [
      { Date: '08/01/2026', Description: '', 'Debit Amount': '34.17', 'Credit Amount': '' },
      { Date: '08/01/2026', Description: 'Rubis', 'Debit Amount': '100.00', 'Credit Amount': '' },
    ],
    MAPPING,
  );
  assert.equal(res.errors.length, 0);
  assert.equal(res.drafts.length, 2);
  assert.equal(res.drafts[0].description, '(no description)');
  assert.equal(res.drafts[0].amount, -34.17);
  assert.equal(res.drafts[1].description, 'Rubis');
});

test('unparseable date still errors', () => {
  const res = applyMapping(
    [{ Date: 'Opening Balance', Description: 'x', 'Debit Amount': '1.00', 'Credit Amount': '' }],
    MAPPING,
  );
  assert.equal(res.drafts.length, 0);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0].reason, /Unparseable date/);
});

test('quoted thousands amounts parse (credit side)', () => {
  const res = applyMapping(
    [{ Date: '07/08/2026', Description: 'PREMIER Roofing', 'Debit Amount': '', 'Credit Amount': '3,312.44' }],
    MAPPING,
  );
  assert.equal(res.errors.length, 0);
  assert.equal(res.drafts[0].amount, 3312.44);
});
