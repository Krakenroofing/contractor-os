// Unpaid-lunch rule + its effect on paid hours / gross. 60 min if a day has
// >= 6h worked, 30 min if under, overridable per day.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lunchDefaultMinutes, effectiveLunchMinutes } from './lunch';
import { computeEmployeePaystub } from './payroll-math';
import type {
  Employee,
  PayPeriod,
  TimeEntry,
  TimesheetLunchOverride,
} from '@/db/schema';

test('lunch default: 60 for >=6h, 30 under, 0 for none; override wins', () => {
  assert.equal(lunchDefaultMinutes(8), 60);
  assert.equal(lunchDefaultMinutes(6), 60);
  assert.equal(lunchDefaultMinutes(5.9), 30);
  assert.equal(lunchDefaultMinutes(0), 0);
  assert.equal(effectiveLunchMinutes(8, undefined), 60);
  assert.equal(effectiveLunchMinutes(8, 0), 0); // explicit "no lunch"
  assert.equal(effectiveLunchMinutes(5, 45), 45);
});

const emp = {
  id: 'e1',
  firstName: 'Ann',
  lastName: 'B',
  employmentType: 'hourly',
  payRate: '20',
  nibExempt: false,
  active: true,
  terminationDate: null,
} as unknown as Employee;

const period = {
  id: 'pp',
  status: 'open',
  startDate: '2026-06-01',
  endDate: '2026-06-07',
} as unknown as PayPeriod;

function hrs(workDate: string, hours: string): TimeEntry {
  return {
    id: workDate,
    employeeId: 'e1',
    entryType: 'hours',
    hours,
    amount: '0',
    workDate,
    projectId: 'p',
    costCodeId: 'c',
  } as unknown as TimeEntry;
}

function lunch(workDate: string, minutes: number): TimesheetLunchOverride {
  return { employeeId: 'e1', workDate, minutes } as unknown as TimesheetLunchOverride;
}

test('hourly gross is net of the default per-day lunch', () => {
  // Mon 8h → −60m = 7.0h paid; Tue 5h → −30m = 4.5h paid; total 11.5h × $20.
  const stub = computeEmployeePaystub(
    emp,
    [hrs('2026-06-01', '8'), hrs('2026-06-02', '5')],
    period,
    [],
    [],
    [],
  );
  assert.equal(stub.hoursWorked, 11.5);
  assert.equal(stub.lunchHours, 1.5);
  assert.equal(stub.gross, 230);
});

test('per-day override removes that day’s lunch', () => {
  const stub = computeEmployeePaystub(
    emp,
    [hrs('2026-06-01', '8'), hrs('2026-06-02', '5')],
    period,
    [],
    [],
    [lunch('2026-06-01', 0)], // no lunch Monday
  );
  // Mon 8h paid + Tue 4.5h = 12.5h × $20 = 250.
  assert.equal(stub.hoursWorked, 12.5);
  assert.equal(stub.gross, 250);
});
