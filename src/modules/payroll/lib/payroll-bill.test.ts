// The payroll bill must balance (debits = credits) and AP must equal net pay,
// mirroring the QuickBooks payroll bill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollBillLines } from './payroll-bill';

const acc = {
  payrollExpense: 'exp',
  nibExpense: 'nibexp',
  nibPayableEmployee: 'nibpe',
  nibPayableEmployer: 'nibpr',
  reimbursementExpense: 'reimb',
  deductionsPayable: 'ded',
  accountsPayable: 'ap',
};

function sums(lines: ReturnType<typeof buildPayrollBillLines>) {
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  return {
    debit: Math.round(debit * 100) / 100,
    credit: Math.round(credit * 100) / 100,
  };
}

test('QB example balances and AP = net pay ($1,200)', () => {
  // gross 1237.67, emp NIB 37.67, empr NIB 53.87, net 1200.00.
  const lines = buildPayrollBillLines(
    {
      gross: 1237.67,
      employeeNib: 37.67,
      employerNib: 53.87,
      additions: 0,
      deductions: 0,
      net: 1200,
    },
    acc,
  );
  const { debit, credit } = sums(lines);
  assert.equal(debit, credit);
  const ap = lines.find((l) => l.accountId === 'ap');
  assert.equal(ap?.credit, 1200);
  // Employer NIB recorded as both expense and payable (offsetting).
  assert.ok(lines.some((l) => l.accountId === 'nibexp' && l.debit === 53.87));
  assert.ok(lines.some((l) => l.accountId === 'nibpr' && l.credit === 53.87));
});

test('balances with per-diem and deductions', () => {
  // gross 1000, ded 50, empNIB 44.17 (4.65% of 950), emprNIB 63.17, per diem 75.
  // net = 1000 − 50 − 44.17 + 75 = 980.83.
  const lines = buildPayrollBillLines(
    {
      gross: 1000,
      employeeNib: 44.17,
      employerNib: 63.17,
      additions: 75,
      deductions: 50,
      net: 980.83,
    },
    acc,
  );
  const { debit, credit } = sums(lines);
  assert.equal(debit, credit);
  assert.equal(lines.find((l) => l.accountId === 'ap')?.credit, 980.83);
});
