// Pure allocation logic for posting a pay period's labor into job_cost_entries.
//
// Per employee, the paystub gross (and the employer NIB burden) is spread
// across the (project, cost code) buckets the employee logged time to, weighted
// by each entry's value: hours × payRate for hours rows, the amount for direct-
// pay rows. Time with no project/cost code (overhead) can't post to a job —
// its share of pay is reported as `unpostedWage`, never silently dropped.

import type { EmployeePaystub } from './payroll-math';
import type { TimeEntry } from '@/db/schema';

export type LaborBucketPosting = {
  projectId: string;
  costCodeId: string;
  /** Direct labor (wages) → COGS. */
  wage: number;
  /** Employer NIB / burden → the separate burden account. */
  burden: number;
};

export type EmployeeLaborAllocation = {
  employeeId: string;
  employeeName: string;
  gross: number;
  employerBurden: number;
  buckets: LaborBucketPosting[];
  postedWage: number;
  /** Gross attributable to untagged/overhead time (or no time at all). */
  unpostedWage: number;
  /** Portion of unpostedWage attributable to service-call time — the
   *  work-order lane carries that job cost, so it's expected here. */
  serviceCallWage: number;
  /** True when this pay was spread across the company's crew job mix
   *  (salaried supervision/support with no time entries of their own). */
  viaCrewHours?: boolean;
};

export type LaborPostingPlan = {
  allocations: EmployeeLaborAllocation[];
  totalWagePosted: number;
  totalBurdenPosted: number;
  totalUnposted: number;
  /** Slice of totalUnposted that is service-call time (costed via WOs). */
  totalServiceCall: number;
  bucketCount: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function entryValue(e: TimeEntry, payRate: number): number {
  return e.entryType === 'amount'
    ? Number(e.amount)
    : Number(e.hours) * payRate;
}

export function computeLaborPostingPlan(
  paystubs: EmployeePaystub[],
  entries: TimeEntry[],
  opts: {
    /** Employees whose pay, when they logged no time of their own, is
     *  spread across the jobs the rest of the crew worked this period
     *  (weighted by the crew's posted wage per project/cost-code bucket).
     *  For salaried supervision/support who never punch — their cost
     *  follows where the work actually happened. */
    crewHoursEmployeeIds?: Set<string>;
  } = {},
): LaborPostingPlan {
  const entriesByEmployee = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const list = entriesByEmployee.get(e.employeeId) ?? [];
    list.push(e);
    entriesByEmployee.set(e.employeeId, list);
  }

  const allocations: EmployeeLaborAllocation[] = [];
  for (const p of paystubs) {
    if (p.skipped || p.gross <= 0) continue;
    const empEntries = entriesByEmployee.get(p.employeeId) ?? [];
    const employerBurden = round2(p.nib.employer);
    const totalValue = empEntries.reduce(
      (s, e) => s + entryValue(e, p.payRate),
      0,
    );

    if (totalValue <= 0) {
      // No usable time signal (e.g. gross set by a manual override with no
      // logged time) — nothing to attribute to a job.
      allocations.push({
        employeeId: p.employeeId,
        employeeName: p.employeeName,
        gross: p.gross,
        employerBurden,
        buckets: [],
        postedWage: 0,
        unpostedWage: p.gross,
        serviceCallWage: 0,
      });
      continue;
    }

    // Service-call slice of the unposted wage: those hours' cost reaches
    // the job via the posted work order, so they're expected off this
    // posting — reported separately so the lock notice doesn't read them
    // as forgotten assignments.
    const serviceValue = empEntries.reduce(
      (s, e) =>
        !e.projectId && e.isServiceCall ? s + entryValue(e, p.payRate) : s,
      0,
    );
    const serviceCallWage = round2(p.gross * (serviceValue / totalValue));

    // Sum value by (project, cost code), skipping untagged/overhead time.
    const byBucket = new Map<
      string,
      { projectId: string; costCodeId: string; value: number }
    >();
    for (const e of empEntries) {
      if (!e.projectId || !e.costCodeId) continue;
      const key = `${e.projectId}:${e.costCodeId}`;
      const cur =
        byBucket.get(key) ??
        { projectId: e.projectId, costCodeId: e.costCodeId, value: 0 };
      cur.value += entryValue(e, p.payRate);
      byBucket.set(key, cur);
    }

    const buckets: LaborBucketPosting[] = [];
    let postedWage = 0;
    for (const b of byBucket.values()) {
      const frac = b.value / totalValue;
      const wage = round2(p.gross * frac);
      const burden = round2(employerBurden * frac);
      if (wage <= 0 && burden <= 0) continue;
      buckets.push({ projectId: b.projectId, costCodeId: b.costCodeId, wage, burden });
      postedWage += wage;
    }
    postedWage = round2(postedWage);

    allocations.push({
      employeeId: p.employeeId,
      employeeName: p.employeeName,
      gross: p.gross,
      employerBurden,
      buckets,
      postedWage,
      unpostedWage: round2(p.gross - postedWage),
      serviceCallWage,
    });
  }

  // Pass 2 — crew-hours allocation. Employees flagged for it who logged
  // NO postable time (and no service-call time — the WO lane covers that)
  // get their gross + burden spread across the company's crew job mix
  // for the period, weighted by the wage the crew posted per bucket.
  const crewIds = opts.crewHoursEmployeeIds;
  if (crewIds && crewIds.size > 0) {
    const weights = new Map<
      string,
      { projectId: string; costCodeId: string; value: number }
    >();
    let weightTotal = 0;
    for (const a of allocations) {
      if (crewIds.has(a.employeeId)) continue; // crew mix only
      for (const b of a.buckets) {
        const key = `${b.projectId}:${b.costCodeId}`;
        const cur =
          weights.get(key) ??
          { projectId: b.projectId, costCodeId: b.costCodeId, value: 0 };
        cur.value += b.wage;
        weights.set(key, cur);
        weightTotal += b.wage;
      }
    }
    if (weightTotal > 0) {
      for (const a of allocations) {
        if (!crewIds.has(a.employeeId)) continue;
        if (a.buckets.length > 0 || a.serviceCallWage > 0) continue;
        let postedWage = 0;
        for (const w of weights.values()) {
          const frac = w.value / weightTotal;
          const wage = round2(a.gross * frac);
          const burden = round2(a.employerBurden * frac);
          if (wage <= 0 && burden <= 0) continue;
          a.buckets.push({
            projectId: w.projectId,
            costCodeId: w.costCodeId,
            wage,
            burden,
          });
          postedWage += wage;
        }
        a.postedWage = round2(postedWage);
        a.unpostedWage = round2(a.gross - a.postedWage);
        a.viaCrewHours = a.buckets.length > 0;
      }
    }
  }

  let totalWagePosted = 0;
  let totalBurdenPosted = 0;
  let totalUnposted = 0;
  let totalServiceCall = 0;
  let bucketCount = 0;
  for (const a of allocations) {
    totalWagePosted += a.postedWage;
    totalUnposted += a.unpostedWage;
    totalServiceCall += a.serviceCallWage;
    for (const b of a.buckets) {
      totalBurdenPosted += b.burden;
      bucketCount += 1;
    }
  }

  return {
    allocations,
    totalWagePosted: round2(totalWagePosted),
    totalBurdenPosted: round2(totalBurdenPosted),
    totalUnposted: round2(totalUnposted),
    totalServiceCall: round2(totalServiceCall),
    bucketCount,
  };
}
