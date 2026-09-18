// Labor → job-cost allocation math. Gross + employer burden split across the
// (project, cost code) buckets an employee logged time to; untagged time is
// reported as unposted, never silently dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLaborPostingPlan } from './labor-posting';
import type { EmployeePaystub } from './payroll-math';
import type { TimeEntry } from '../../../db/schema/time-entries';

function stub(over: Partial<EmployeePaystub>): EmployeePaystub {
  return {
    employeeId: 'e1',
    employeeName: 'Worker',
    employmentType: 'hourly',
    hoursWorked: 0,
    payRate: 25,
    gross: 0,
    grossSource: 'rate',
    payDescription: null,
    deductions: [],
    additions: [],
    adjustedGross: 0,
    deductionsTotal: 0,
    additionsTotal: 0,
    nib: { gross: 0, insurableWage: 0, employee: 0, employer: 0, total: 0 },
    nibExempt: false,
    net: 0,
    skipped: false,
    ...over,
  } as EmployeePaystub;
}

function entry(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'x',
    companyId: 'c',
    employeeId: 'e1',
    payPeriodId: 'pp',
    workDate: '2026-06-01',
    entryType: 'hours',
    hours: '0',
    amount: '0',
    projectId: null,
    costCodeId: null,
    isOverhead: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as TimeEntry;
}

test('hourly: untagged/overhead time is reported as unposted', () => {
  const paystubs = [
    stub({ gross: 1000, payRate: 25, nib: { gross: 0, insurableWage: 0, employee: 0, employer: 66.5, total: 0 } }),
  ];
  const entries = [
    entry({ entryType: 'hours', hours: '30', projectId: 'pA', costCodeId: 'cX' }),
    entry({ entryType: 'hours', hours: '10', projectId: null, costCodeId: null }),
  ];
  const plan = computeLaborPostingPlan(paystubs, entries);
  assert.equal(plan.bucketCount, 1);
  assert.equal(plan.allocations[0].buckets[0].wage, 750);
  assert.equal(plan.allocations[0].buckets[0].burden, 49.88); // 66.50 * 0.75
  assert.equal(plan.totalWagePosted, 750);
  assert.equal(plan.totalUnposted, 250);
});

test('amount entries split exactly by amount across two jobs', () => {
  const paystubs = [stub({ gross: 500, payRate: 0, employmentType: 'contract' })];
  const entries = [
    entry({ entryType: 'amount', amount: '300', projectId: 'pA', costCodeId: 'cX' }),
    entry({ entryType: 'amount', amount: '200', projectId: 'pB', costCodeId: 'cY' }),
  ];
  const plan = computeLaborPostingPlan(paystubs, entries);
  const wages = plan.allocations[0].buckets.map((b) => b.wage).sort((a, b) => a - b);
  assert.deepEqual(wages, [200, 300]);
  assert.equal(plan.totalUnposted, 0);
});

test('override gross is distributed by the shape of logged time', () => {
  // Gross 900 (override) but 40h logged @ $25 = $1000 of value, all tagged.
  const paystubs = [stub({ gross: 900, payRate: 25 })];
  const entries = [
    entry({ entryType: 'hours', hours: '40', projectId: 'pA', costCodeId: 'cX' }),
  ];
  const plan = computeLaborPostingPlan(paystubs, entries);
  assert.equal(plan.allocations[0].buckets[0].wage, 900);
  assert.equal(plan.totalUnposted, 0);
});

test('gross with no time at all is fully unposted', () => {
  const paystubs = [stub({ gross: 400 })];
  const plan = computeLaborPostingPlan(paystubs, []);
  assert.equal(plan.bucketCount, 0);
  assert.equal(plan.totalUnposted, 400);
});

test('skipped and zero-gross paystubs are ignored', () => {
  const paystubs = [
    stub({ employeeId: 'a', skipped: true, gross: 1000 }),
    stub({ employeeId: 'b', gross: 0 }),
  ];
  const entries = [
    entry({ employeeId: 'a', entryType: 'hours', hours: '8', projectId: 'pA', costCodeId: 'cX' }),
  ];
  const plan = computeLaborPostingPlan(paystubs, entries);
  assert.equal(plan.allocations.length, 0);
  assert.equal(plan.bucketCount, 0);
});

test('crew-hours: flagged salaried with no entries spreads across crew job mix', () => {
  const paystubs = [
    stub({
      employeeId: 'crew1',
      gross: 1000,
      payRate: 25,
      nib: { gross: 0, insurableWage: 0, employee: 0, employer: 66.5, total: 0 },
    }),
    stub({
      employeeId: 'sup1',
      employeeName: 'Supervisor',
      employmentType: 'salaried',
      gross: 3600,
      payRate: 3600,
      nib: { gross: 0, insurableWage: 0, employee: 0, employer: 53.87, total: 0 },
    }),
  ];
  const entries = [
    // Crew: 30h on (pA,cX), 10h on (pB,cY) → 75% / 25% split.
    entry({ employeeId: 'crew1', hours: '30', projectId: 'pA', costCodeId: 'cX' }),
    entry({ employeeId: 'crew1', hours: '10', projectId: 'pB', costCodeId: 'cY' }),
  ];
  const plan = computeLaborPostingPlan(paystubs, entries, {
    crewHoursEmployeeIds: new Set(['sup1']),
  });
  const sup = plan.allocations.find((a) => a.employeeId === 'sup1')!;
  assert.equal(sup.viaCrewHours, true);
  assert.equal(sup.buckets.length, 2);
  const byProject = new Map(sup.buckets.map((b) => [b.projectId, b]));
  assert.equal(byProject.get('pA')!.wage, 2700); // 75% of 3600
  assert.equal(byProject.get('pB')!.wage, 900); // 25%
  assert.equal(byProject.get('pA')!.burden, 40.4); // 75% of 53.87
  assert.equal(sup.postedWage, 3600);
  assert.equal(sup.unpostedWage, 0);
});

test('crew-hours: flagged employee with own entries keeps them (entries win)', () => {
  const paystubs = [
    stub({ employeeId: 'crew1', gross: 1000, payRate: 25 }),
    stub({ employeeId: 'sup1', employmentType: 'salaried', gross: 1200, payRate: 1200 }),
  ];
  const entries = [
    entry({ employeeId: 'crew1', hours: '40', projectId: 'pA', costCodeId: 'cX' }),
    entry({ employeeId: 'sup1', hours: '8', projectId: 'pB', costCodeId: 'cY' }),
  ];
  const plan = computeLaborPostingPlan(paystubs, entries, {
    crewHoursEmployeeIds: new Set(['sup1']),
  });
  const sup = plan.allocations.find((a) => a.employeeId === 'sup1')!;
  assert.equal(sup.viaCrewHours ?? false, false);
  assert.equal(sup.buckets.length, 1);
  assert.equal(sup.buckets[0].projectId, 'pB');
});

test('crew-hours: no crew signal at all leaves flagged pay unposted', () => {
  const paystubs = [
    stub({ employeeId: 'sup1', employmentType: 'salaried', gross: 1200, payRate: 1200 }),
  ];
  const plan = computeLaborPostingPlan(paystubs, [], {
    crewHoursEmployeeIds: new Set(['sup1']),
  });
  const sup = plan.allocations.find((a) => a.employeeId === 'sup1')!;
  assert.equal(sup.viaCrewHours ?? false, false);
  assert.equal(sup.unpostedWage, 1200);
});

test('crew-hours: flagged employees never feed the weight pool', () => {
  // Two flagged supervisors + one crew guy: both supervisors follow the
  // crew's single job, not each other.
  const paystubs = [
    stub({ employeeId: 'crew1', gross: 500, payRate: 25 }),
    stub({ employeeId: 'sup1', employmentType: 'salaried', gross: 1000, payRate: 1000 }),
    stub({ employeeId: 'sup2', employmentType: 'salaried', gross: 2000, payRate: 2000 }),
  ];
  const entries = [
    entry({ employeeId: 'crew1', hours: '20', projectId: 'pA', costCodeId: 'cX' }),
  ];
  const plan = computeLaborPostingPlan(paystubs, entries, {
    crewHoursEmployeeIds: new Set(['sup1', 'sup2']),
  });
  for (const id of ['sup1', 'sup2']) {
    const a = plan.allocations.find((x) => x.employeeId === id)!;
    assert.equal(a.buckets.length, 1);
    assert.equal(a.buckets[0].projectId, 'pA');
    assert.equal(a.unpostedWage, 0);
  }
});
