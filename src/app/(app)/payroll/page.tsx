import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
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
import {
  ByJobView,
  type ByJobRow,
} from '@/modules/payroll/components/by-job-view';
import { PaystubsView } from '@/modules/payroll/components/paystubs-view';
import { C17SummaryView } from '@/modules/payroll/components/c17-summary';
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
  computeC17Summary,
  computePeriodPaystubs,
} from '@/modules/payroll/lib/payroll-math';

export const dynamic = 'force-dynamic';

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
    sp.view === 'by-job'
      ? 'by-job'
      : sp.view === 'paystubs'
        ? 'paystubs'
        : sp.view === 'c17'
          ? 'c17'
          : sp.view === 'subs'
            ? 'subs'
            : 'timesheet';

  // Find or create the period containing the requested week.
  const period = await getOrCreatePeriodForDate(companyId, requestedWeek);
  const isLocked = period.status === 'locked';
  const days = weekDates(period.startDate);

  const [allEmployees, allProjects, allEntries] = await Promise.all([
    listEmployees(companyId),
    listProjects(companyId),
    listTimeEntries(companyId, { payPeriodId: period.id }),
  ]);
  const employeeById = new Map(allEmployees.map((e) => [e.id, e]));
  const projectById = new Map(allProjects.map((p) => [p.id, p]));

  // Aggregate hours per (employee, date) for the timesheet grid. We include
  // every active employee even if they have zero hours so the grid is the
  // full roster instead of "people who happened to log something."
  const activeEmployees = allEmployees.filter((e) => e.active);
  const timesheetRows: TimesheetEmployee[] = activeEmployees.map((e) => {
    const hoursByDate: Record<string, number> = {};
    for (const entry of allEntries) {
      if (entry.employeeId !== e.id) continue;
      hoursByDate[entry.workDate] =
        (hoursByDate[entry.workDate] ?? 0) + Number(entry.hours);
    }
    return {
      id: e.id,
      fullName: `${e.firstName} ${e.lastName}`.trim(),
      hoursByDate,
    };
  });

  // Build by-job rows. Each time entry becomes one row; project null →
  // "Unassigned" group.
  const byJobRows: ByJobRow[] = allEntries.map((entry) => {
    const emp = employeeById.get(entry.employeeId);
    const proj = entry.projectId ? projectById.get(entry.projectId) : undefined;
    return {
      id: entry.id,
      workDate: entry.workDate,
      employeeName: emp
        ? `${emp.firstName} ${emp.lastName}`.trim()
        : '— deleted —',
      projectId: entry.projectId,
      projectName: proj?.name ?? 'Unassigned',
      // We don't carry the cost code label in time_entries — defer that to a
      // future enrichment if needed. For now we surface the FK presence as a
      // monospace dash.
      costCode: entry.costCodeId ? '…' : null,
      hours: entry.hours,
      notes: entry.notes,
      canEdit: allowEdit && !isLocked,
    };
  });

  const totalHours = allEntries.reduce((a, e) => a + Number(e.hours), 0);

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
            hrs logged this week
          </p>
        </div>
        {allowEdit && !isLocked && (
          <Link href={`/payroll/entries/new?workDate=${period.startDate}`}>
            <Button>Add time entry</Button>
          </Link>
        )}
      </header>

      <PeriodSelector
        weekStart={period.startDate}
        weekEnd={period.endDate}
        status={period.status as 'open' | 'locked'}
      />

      <PayrollTabs active={view} weekStart={period.startDate} />

      {view === 'timesheet' && (
        <TimesheetGrid
          days={days}
          employees={timesheetRows}
          weekStart={period.startDate}
          allowEdit={allowEdit}
          locked={isLocked}
        />
      )}

      {view === 'by-job' && (
        <ByJobView
          rows={byJobRows}
          allowEdit={allowEdit}
          locked={isLocked}
          weekStart={period.startDate}
        />
      )}

      {(view === 'paystubs' || view === 'c17') &&
        (() => {
          // Paystubs and C17 share the same compute step. Both views derive
          // from the same paystub array so the totals on C17 always match
          // the sum of the cards on the Paystubs tab.
          const paystubs = computePeriodPaystubs(allEmployees, allEntries, period);
          const summary = computeC17Summary(paystubs);
          if (view === 'paystubs') {
            return <PaystubsView paystubs={paystubs} />;
          }
          return (
            <C17SummaryView
              summary={summary}
              paystubs={paystubs}
              periodLabel={formatPeriodLabel(period.startDate, period.endDate)}
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
