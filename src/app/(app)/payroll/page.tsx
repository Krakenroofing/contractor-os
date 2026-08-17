import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate, canView } from '@/lib/permissions';
import { listEmployees } from '@/lib/data/employees';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { getOrCreatePeriodForDate } from '@/lib/data/pay-periods';
import { listTimeEntries } from '@/lib/data/time-entries';
import { PeriodSelector } from '@/modules/payroll/components/period-selector';
import { PayrollTabs, type TabKey } from '@/modules/payroll/components/tabs';
import {
  TimesheetGrid,
  type TimesheetEmployee,
} from '@/modules/payroll/components/timesheet-grid';
import { PaystubsView } from '@/modules/payroll/components/paystubs-view';
import { C10SummaryView } from '@/modules/payroll/components/c10-summary';
import { nibCeilingForDate } from '@/modules/payroll/lib/nib';
import {
  PayRunTable,
  type PayRunRow,
} from '@/modules/payroll/components/pay-run-table';
import { listPeriodPayOverrides } from '@/lib/data/period-pay-overrides';
import { listPaystubSnapshots } from '@/lib/data/period-paystub-snapshots';
import { listPaystubAdjustments } from '@/lib/data/paystub-adjustments';
import { PeriodLockButton } from '@/modules/payroll/components/period-lock-button';
import { PostLaborButton } from '@/modules/payroll/components/post-labor-button';
import {
  LaborAllocationPanel,
  type LaborAllocationProjectRow,
  type LaborAllocationUnpostedRow,
} from '@/modules/payroll/components/labor-allocation-panel';
import { computeLaborPostingPlan } from '@/modules/payroll/lib/labor-posting';
import { GeneratePayrollBillsButton } from '@/modules/payroll/components/generate-bills-button';
import { PayrollAdjustmentsSection } from '@/modules/payroll/components/payroll-adjustments-section';
import { PieceWorkSection } from '@/modules/payroll/components/piece-work-section';
import { listJobCostEntriesBySource } from '@/lib/data/job-cost-entries';
import { listPayrollBills } from '@/lib/data/payroll-bills';
import { listLunchOverrides } from '@/lib/data/timesheet-lunch';
import { effectiveLunchMinutes } from '@/modules/payroll/lib/lunch';
import { computeHourlyOvertime } from '@/modules/payroll/lib/overtime';
import { bahamasHolidaySet } from '@/modules/payroll/lib/holidays';
import { parseMoney, round2 } from '@/lib/money';
import type { EmploymentType } from '@/modules/employees/schema';
import {
  SubPaymentsListClient,
  type SubPaymentRow,
} from '@/modules/subcontractor-payments/components/sub-payments-list-client';
import { listSubcontractorPayments } from '@/lib/data/subcontractor-payments';
import { listVendors } from '@/lib/data/vendors';
import type { SubPaymentStatus } from '@/modules/subcontractor-payments/schema';
import {
  formatPeriodLabel,
  mondayOf,
  todayISO,
  weekDates,
} from '@/modules/payroll/lib/periods';
import {
  computeC10Summary,
  computePeriodPaystubs,
} from '@/modules/payroll/lib/payroll-math';

export const dynamic = 'force-dynamic';

// Variable-pay employment types: gross comes from per-day $ amounts, not
// hours × a fixed rate. The timesheet surfaces their daily pay alongside
// hours; hourly / salaried are paid off their rate and show hours only.
const VARIABLE_PAY_TYPES: ReadonlySet<EmploymentType> = new Set([
  'piecework',
  'contract',
  'commission',
  'lump_sum',
]);

export default async function PayrollPage({
  searchParams,
}: {
  searchParams?: Promise<{ week?: string; view?: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'payroll')) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-600">
          You don't have access to payroll.
        </p>
      </div>
    );
  }
  const allowEdit = canCreate(role, 'payroll');
  const companyId = await getActiveCompanyId();

  const sp = (await searchParams) ?? {};
  const requestedWeek =
    typeof sp.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.week)
      ? mondayOf(sp.week)
      : mondayOf(todayISO());
  const view: TabKey =
    sp.view === 'pay-run'
      ? 'pay-run'
      : sp.view === 'paystubs'
        ? 'paystubs'
        : sp.view === 'c10'
          ? 'c10'
          : sp.view === 'subs'
            ? 'subs'
            : 'timesheet';

  // Find or create the period containing the requested week.
  const period = await getOrCreatePeriodForDate(companyId, requestedWeek);
  const isLocked = period.status === 'locked';
  const days = weekDates(period.startDate);

  const [
    allEmployees,
    allProjects,
    allCostCodes,
    allEntries,
    allOverrides,
    allSnapshots,
    allAdjustments,
  ] = await Promise.all([
    listEmployees(companyId),
    listProjects(companyId),
    listCostCodes(companyId),
    listTimeEntries(companyId, { payPeriodId: period.id }),
    listPeriodPayOverrides(companyId, { payPeriodId: period.id }),
    listPaystubSnapshots(companyId, { payPeriodId: period.id }),
    listPaystubAdjustments(companyId, { payPeriodId: period.id }),
  ]);
  // Labor → job costs posting state for this period.
  const activeCompany = await getActiveCompany();
  const laborAccountsConfigured = !!(
    activeCompany.laborCogsAccountId && activeCompany.laborBurdenAccountId
  );
  const laborPostedEntries = await listJobCostEntriesBySource(
    companyId,
    'labor_entry',
    period.id,
  );
  const laborPostedCount = laborPostedEntries.length;
  const payrollBillCount = (await listPayrollBills(companyId, period.id)).length;
  // Unpaid lunch overrides for this period, indexed by employee+date.
  const lunchOverrides = await listLunchOverrides(companyId, period.id);
  const lunchByEmpDate = new Map(
    lunchOverrides.map((l) => [`${l.employeeId}:${l.workDate}`, l.minutes]),
  );
  const holidaySet = bahamasHolidaySet(
    Array.from(
      new Set([
        Number(period.startDate.slice(0, 4)),
        Number(period.endDate.slice(0, 4)),
      ]),
    ),
  );

  // Per-employee pay adjustments (per diem / reimbursement / bonus / deduction)
  // surfaced on the Timesheet + Pay Run tabs. Built from the same paystub math.
  const adjustmentStubs = computePeriodPaystubs(
    allEmployees,
    allEntries,
    period,
    allOverrides,
    allSnapshots,
    allAdjustments,
    lunchOverrides,
  );
  const adjStubByEmp = new Map(adjustmentStubs.map((p) => [p.employeeId, p]));
  const adjustmentRows = allEmployees
    .filter((e) => e.active)
    .map((e) => {
      const s = adjStubByEmp.get(e.id);
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        deductions: s?.deductions ?? [],
        additions: s?.additions ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Piece work (Pay Run): job-allocated one-off pay lines. Options for the
  // pickers + each employee's existing allocated amount lines this period.
  const projectOptions = allProjects.map((p) => ({ id: p.id, label: p.name }));
  const costCodeOptions = allCostCodes.map((c) => ({
    id: c.id,
    label: `${c.code} — ${c.description}`,
  }));
  const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]));
  const pieceWorkRows = allEmployees
    .filter((e) => e.active)
    .map((e) => ({
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      lines: allEntries
        .filter(
          (t) =>
            t.employeeId === e.id &&
            t.entryType === 'amount' &&
            t.projectId &&
            Number(t.amount) > 0,
        )
        .map((t) => ({
          id: t.id,
          amount: Number(t.amount),
          date: t.workDate,
          projectLabel: projectNameById.get(t.projectId!) ?? 'Job',
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Aggregate per-(employee, date) for the timesheet grid. The timesheet
  // is a record of HOURS for everyone — that's what a timesheet is. For
  // variable-pay workers (contract / piecework / commission / lump-sum)
  // each cell also surfaces the day's $ pay (entry_type='amount' rows)
  // beneath the hours, since their gross is the sum of those daily
  // amounts, not hours × a fixed rate. Hourly / salaried show hours only;
  // their pay is computed from the rate on the Pay Run tab.
  // Active roster is included even when nothing is logged so the grid
  // mirrors the full team, not just "people who happened to enter something."
  const activeEmployees = allEmployees.filter((e) => e.active);
  const timesheetRows: TimesheetEmployee[] = activeEmployees.map((e) => {
    const employmentType = e.employmentType as EmploymentType;
    const isVariablePay = VARIABLE_PAY_TYPES.has(employmentType);
    // Per-day roll-up keeps the row COUNT alongside the sum: a day with a
    // single hours/pay row is inline-editable; a day split across projects
    // (>1 row) is handed off to the day-detail view so we never collapse
    // an allocation.
    const days: Record<
      string,
      {
        hours: number;
        hoursCount: number;
        pay: number;
        payCount: number;
        payUnassigned: boolean;
        hoursUnassigned: boolean;
        lunchMinutes: number;
      }
    > = {};
    for (const entry of allEntries) {
      if (entry.employeeId !== e.id) continue;
      const slot = (days[entry.workDate] ??= {
        hours: 0,
        hoursCount: 0,
        pay: 0,
        payCount: 0,
        payUnassigned: false,
        hoursUnassigned: false,
        lunchMinutes: 0,
      });
      if (entry.entryType === 'amount') {
        slot.pay += Number(entry.amount);
        slot.payCount += 1;
        // Day-rate pay that has no project or no cost code won't post to job
        // costs — flag it so the office can allocate it.
        if (!entry.projectId || !entry.costCodeId) slot.payUnassigned = true;
      } else {
        slot.hours += Number(entry.hours);
        slot.hoursCount += 1;
        // Hours count as "assigned" once they're on a project (or explicitly
        // overhead). Clock-posted hours carry the punch's project but usually
        // NO cost code, so we deliberately DON'T require a cost code here —
        // otherwise every clocked-in shift would nag. Only truly floating
        // hours (typed inline, no project, not overhead) prompt "+ assign job".
        if (!entry.projectId && !entry.isOverhead) slot.hoursUnassigned = true;
      }
    }
    // Lunch only affects hourly pay; show the deduction line for those.
    const appliesLunch = employmentType === 'hourly';
    if (appliesLunch) {
      for (const [date, slot] of Object.entries(days)) {
        slot.lunchMinutes = effectiveLunchMinutes(
          slot.hours,
          lunchByEmpDate.get(`${e.id}:${date}`),
        );
      }
    }
    return {
      id: e.id,
      fullName: `${e.firstName} ${e.lastName}`.trim(),
      employmentType,
      isVariablePay,
      appliesLunch,
      days,
    };
  });

  // Header summary: hours for entry_type='hours' rows + dollars for
  // entry_type='amount' rows. Display them separately so each unit
  // remains meaningful.
  const totalHours = allEntries
    .filter((e) => e.entryType !== 'amount')
    .reduce((a, e) => a + Number(e.hours), 0);
  const totalAmount = allEntries
    .filter((e) => e.entryType === 'amount')
    .reduce((a, e) => a + Number(e.amount), 0);

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — payroll runs against the in-memory mock store. Add a few
          employees and time entries to see the grid populate.
        </div>
      )}

      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Payroll</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Weekly timesheet · {allEntries.length}{' '}
            {allEntries.length === 1 ? 'entry' : 'entries'} ·{' '}
            <strong className="text-slate-900 tabular-nums">
              {totalHours.toFixed(2)}
            </strong>{' '}
            hrs
            {totalAmount > 0 && (
              <>
                {' · '}
                <strong className="text-slate-900 tabular-nums">
                  ${totalAmount.toFixed(2)}
                </strong>{' '}
                in variable pay
              </>
            )}{' '}
            logged this week
          </p>
        </div>
        {allowEdit && !isLocked && (
          <Link href={`/payroll/entries/new?workDate=${period.startDate}`}>
            <Button>Add time entry</Button>
          </Link>
        )}
      </header>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PeriodSelector
          weekStart={period.startDate}
          weekEnd={period.endDate}
          status={period.status as 'open' | 'locked'}
        />
        <div className="flex items-center gap-2">
          <a
            href={`/payroll/export.csv?week=${period.startDate}`}
            className="inline-flex h-9 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download CSV
          </a>
          {allowEdit && (
            <PeriodLockButton payPeriodId={period.id} locked={isLocked} />
          )}
        </div>
      </div>

      <PayrollTabs active={view} weekStart={period.startDate} />

      {view === 'timesheet' && (
        <div className="space-y-4">
          <TimesheetGrid
            days={days}
            employees={timesheetRows}
            weekStart={period.startDate}
            allowEdit={allowEdit}
            locked={isLocked}
          />
          <PayrollAdjustmentsSection
            rows={adjustmentRows}
            payPeriodId={period.id}
            locked={isLocked}
          />
        </div>
      )}

      {view === 'pay-run' &&
        (() => {
          // Pay Run table: one row per active employee with editable gross
          // for the period. Hourly = hours × rate. Salaried = weekly rate.
          // Piecework / contract / commission / lump-sum = sum of any
          // amount-type entries logged so far this week. The override
          // input takes precedence over all of that when set.
          const overrideByEmpId = new Map(
            allOverrides.map((o) => [o.employeeId, o]),
          );
          // Net pay per employee (gross + reimbursements/per-diem − employee
          // NIB − deductions) — the figure that ties to the actual payment.
          const payRunStubs = computePeriodPaystubs(
            allEmployees,
            allEntries,
            period,
            allOverrides,
            allSnapshots,
            allAdjustments,
            lunchOverrides,
          );
          const stubByEmp = new Map(payRunStubs.map((p) => [p.employeeId, p]));
          const rows: PayRunRow[] = allEmployees
            .filter((e) => e.active)
            .map((e) => {
              const employmentType = e.employmentType as EmploymentType;
              const payRate = parseMoney(e.payRate);
              const myEntries = allEntries.filter(
                (entry) => entry.employeeId === e.id,
              );
              // Paid hours = logged hours net of the per-day unpaid lunch
              // (hourly only), matching the paystub.
              const grossByDate = new Map<string, number>();
              for (const entry of myEntries) {
                if (entry.entryType === 'amount') continue;
                grossByDate.set(
                  entry.workDate,
                  (grossByDate.get(entry.workDate) ?? 0) +
                    parseMoney(entry.hours),
                );
              }
              const netHoursByDate = new Map<string, number>();
              for (const [date, dh] of grossByDate) {
                const lunchMin =
                  employmentType === 'hourly'
                    ? effectiveLunchMinutes(
                        dh,
                        lunchByEmpDate.get(`${e.id}:${date}`),
                      )
                    : 0;
                netHoursByDate.set(date, Math.max(0, dh - lunchMin / 60));
              }
              const hours = round2(
                [...netHoursByDate.values()].reduce((a, b) => a + b, 0),
              );
              const amountTotal = round2(
                myEntries
                  .filter((entry) => entry.entryType === 'amount')
                  .reduce((sum, entry) => sum + parseMoney(entry.amount), 0),
              );
              const rateGross =
                employmentType === 'hourly'
                  ? computeHourlyOvertime(
                      netHoursByDate,
                      period.startDate,
                      holidaySet,
                      payRate,
                    ).gross
                  : employmentType === 'salaried'
                    ? round2(payRate)
                    : amountTotal;
              const existing = overrideByEmpId.get(e.id);
              const stub = stubByEmp.get(e.id);
              return {
                employeeId: e.id,
                employeeName: `${e.firstName} ${e.lastName}`.trim(),
                employmentType,
                hoursWorked: hours,
                payRate,
                rateGross,
                overrideAmount: existing?.grossAmount ?? '',
                nibExempt: e.nibExempt,
                // True gross the paystub pays on (rate/override + piece work);
                // falls back to rateGross when there's no stub yet.
                grossFull: stub?.gross ?? rateGross,
                net: stub?.net ?? 0,
                perDiem: stub?.additionsTotal ?? 0,
                employeeNib: stub?.nib.employee ?? 0,
                employerNib: stub?.nib.employer ?? 0,
                deductions: stub?.deductionsTotal ?? 0,
              };
            })
            .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
          // Payroll-side view of the labor → job-costing split. The plan is
          // recomputed live from the timesheet; when a posting exists we
          // compare totals so a stale posting surfaces as a drift warning.
          const allocationPlan = computeLaborPostingPlan(payRunStubs, allEntries);
          const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]));
          const allocByProject = new Map<
            string,
            { wage: number; burden: number; employees: Set<string> }
          >();
          for (const a of allocationPlan.allocations) {
            for (const b of a.buckets) {
              const agg = allocByProject.get(b.projectId) ?? {
                wage: 0,
                burden: 0,
                employees: new Set<string>(),
              };
              agg.wage = round2(agg.wage + b.wage);
              agg.burden = round2(agg.burden + b.burden);
              agg.employees.add(a.employeeName);
              allocByProject.set(b.projectId, agg);
            }
          }
          const allocationRows: LaborAllocationProjectRow[] = [...allocByProject]
            .map(([projectId, agg]) => ({
              projectId,
              projectName: projectNameById.get(projectId) ?? 'Deleted project',
              employees: [...agg.employees].sort(),
              wage: agg.wage,
              burden: agg.burden,
            }))
            .sort((a, b) => b.wage - a.wage);
          const unpostedRows: LaborAllocationUnpostedRow[] =
            allocationPlan.allocations
              .filter((a) => a.unpostedWage > 0.004)
              .map((a) => ({
                employeeName: a.employeeName,
                amount: a.unpostedWage,
                hasTime: allEntries.some((e) => e.employeeId === a.employeeId),
              }))
              .sort((a, b) => b.amount - a.amount);
          const postedWage = round2(
            laborPostedEntries
              .filter((e) => e.costType === 'labor')
              .reduce((s, e) => s + parseMoney(e.amount), 0),
          );
          const postedBurden = round2(
            laborPostedEntries
              .filter((e) => e.costType === 'labor_burden')
              .reduce((s, e) => s + parseMoney(e.amount), 0),
          );
          const allocationDrift =
            laborPostedCount > 0 &&
            (Math.abs(postedWage - allocationPlan.totalWagePosted) > 0.01 ||
              Math.abs(postedBurden - allocationPlan.totalBurdenPosted) > 0.01);
          return (
            <div className="space-y-4">
              <PayRunTable
                rows={rows}
                payPeriodId={period.id}
                locked={isLocked}
              />
              <LaborAllocationPanel
                rows={allocationRows}
                unposted={unpostedRows}
                locked={isLocked}
                postedCount={laborPostedCount}
                postedWage={postedWage}
                postedBurden={postedBurden}
                drift={allocationDrift}
              />
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-medium text-slate-700">
                  Post labor to job costs
                </h3>
                <p className="mt-0.5 mb-2 text-xs text-slate-500">
                  Spreads each person&apos;s pay across the projects they logged
                  time to (wages → labor, employer NIB → burden) so it lands on
                  the P&amp;L. Re-postable and reversible.
                </p>
                <PostLaborButton
                  payPeriodId={period.id}
                  locked={isLocked}
                  accountsConfigured={laborAccountsConfigured}
                  postedCount={laborPostedCount}
                />
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-medium text-slate-700">
                  Generate payroll bills
                </h3>
                <p className="mt-0.5 mb-2 text-xs text-slate-500">
                  One QuickBooks-style bill per employee: gross wages expensed,
                  employee NIB withheld to NIB Payable, employer NIB expensed
                  and accrued to NIB Payable, net pay to Accounts Payable. Then
                  match the bank withdrawal to these bills (&quot;Pay
                  bills…&quot; on the bank line) — do NOT also categorize the
                  withdrawal as a payroll expense, or it double-counts. Fine to
                  use together with &quot;Post labor to job costs&quot; (that
                  feeds job costing / P&amp;L; this feeds the GL and the
                  payables).
                </p>
                <GeneratePayrollBillsButton
                  payPeriodId={period.id}
                  locked={isLocked}
                  billCount={payrollBillCount}
                />
              </div>
              <PayrollAdjustmentsSection
                rows={adjustmentRows}
                payPeriodId={period.id}
                locked={isLocked}
              />
              <PieceWorkSection
                rows={pieceWorkRows}
                projects={projectOptions}
                costCodes={costCodeOptions}
                periodStart={period.startDate}
                periodEnd={period.endDate}
                locked={isLocked}
              />
            </div>
          );
        })()}

      {(view === 'paystubs' || view === 'c10') &&
        (() => {
          // Paystubs and C-10 share the same compute step. Both views derive
          // from the same paystub array so the totals on the C-10 view always
          // match the sum of the cards on the Paystubs tab.
          const paystubs = computePeriodPaystubs(
            allEmployees,
            allEntries,
            period,
            allOverrides,
            allSnapshots,
            allAdjustments,
            lunchOverrides,
          );
          const summary = computeC10Summary(paystubs);
          if (view === 'paystubs') {
            return (
              <PaystubsView
                paystubs={paystubs}
                payPeriodId={period.id}
                locked={isLocked}
                projectNames={Object.fromEntries(
                  allProjects.map((p) => [p.id, p.name]),
                )}
              />
            );
          }
          return (
            <C10SummaryView
              summary={summary}
              paystubs={paystubs}
              periodLabel={formatPeriodLabel(period.startDate, period.endDate)}
              weeklyWageCeiling={
                nibCeilingForDate(period.endDate).weeklyWageCeiling
              }
              monthlyWageCeiling={
                nibCeilingForDate(period.endDate).monthlyWageCeiling
              }
            />
          );
        })()}

      {view === 'subs' && (
        <SubsTab companyId={companyId} allowEdit={allowEdit} />
      )}
    </div>
  );
}

async function SubsTab({
  companyId,
  allowEdit,
}: {
  companyId: string;
  allowEdit: boolean;
}) {
  const [subs, allProjects, allVendors] = await Promise.all([
    listSubcontractorPayments(companyId),
    listProjects(companyId),
    listVendors(companyId),
  ]);
  const projectById = new Map(allProjects.map((p) => [p.id, p]));
  const vendorById = new Map(allVendors.map((v) => [v.id, v]));

  const rows: SubPaymentRow[] = subs.map((s) => {
    const vendor = vendorById.get(s.vendorId);
    const project = s.projectId ? projectById.get(s.projectId) : undefined;
    return {
      id: s.id,
      vendorId: s.vendorId,
      vendorName: vendor?.name ?? '— deleted —',
      projectId: s.projectId,
      projectName: project?.name ?? 'Unassigned',
      workPeriodStart: s.workPeriodStart,
      workPeriodEnd: s.workPeriodEnd,
      scopeDescription: s.scopeDescription,
      grossAmount: s.grossAmount,
      retainagePercent: s.retainagePercent,
      retainageHeld: s.retainageHeld,
      netPaid: s.netPaid,
      paidDate: s.paidDate,
      status: s.status as SubPaymentStatus,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {rows.length}{' '}
          {rows.length === 1
            ? 'subcontractor payment'
            : 'subcontractor payments'}
        </p>
        {allowEdit && (
          <Link href="/payroll/subcontractor-payments/new">
            <Button>Add subcontractor payment</Button>
          </Link>
        )}
      </div>
      <SubPaymentsListClient rows={rows} allowEdit={allowEdit} />
    </div>
  );
}
