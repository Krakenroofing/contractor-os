// Day-detail view for a single employee's time entries on a single date.
// Reached by clicking a value cell in the weekly timesheet grid. Shows
// the breakdown that rolls up into the cell total — which project /
// cost code / overhead each chunk of hours (or pay amount) went to.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { listEmployees } from '@/lib/data/employees';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listTimeEntries } from '@/lib/data/time-entries';
import { getOrCreatePeriodForDate } from '@/lib/data/pay-periods';
import { formatMoney, parseMoney } from '@/lib/money';
import { mondayOf } from '@/modules/payroll/lib/periods';
import { DeleteTimeEntryButton } from '@/modules/payroll/components/delete-time-entry-button';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
  type EmploymentType,
} from '@/modules/employees/schema';

export const dynamic = 'force-dynamic';

function formatLongDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function PayrollDayPage({
  searchParams,
}: {
  searchParams?: Promise<{ employeeId?: string; workDate?: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'payroll')) redirect('/payroll');
  const allowEdit = canCreate(role, 'payroll');

  const sp = (await searchParams) ?? {};
  const employeeId = sp.employeeId;
  const workDate = sp.workDate;
  if (
    !employeeId ||
    !workDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(workDate)
  ) {
    notFound();
  }

  const companyId = await getActiveCompanyId();
  const weekStart = mondayOf(workDate);

  const [allEmployees, allProjects, allCostCodes, period] = await Promise.all([
    listEmployees(companyId),
    listProjects(companyId),
    listCostCodes(companyId),
    getOrCreatePeriodForDate(companyId, workDate),
  ]);

  const employee = allEmployees.find((e) => e.id === employeeId);
  if (!employee) notFound();

  const projectById = new Map(allProjects.map((p) => [p.id, p]));
  const costCodeById = new Map(allCostCodes.map((c) => [c.id, c]));

  const allEntries = await listTimeEntries(companyId, {
    payPeriodId: period.id,
    employeeId,
  });
  const dayEntries = allEntries
    .filter((e) => e.workDate === workDate)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const employmentType = employee.employmentType as EmploymentType;

  const totalHours = dayEntries
    .filter((e) => e.entryType !== 'amount')
    .reduce((sum, e) => sum + parseMoney(e.hours), 0);
  const totalAmount = dayEntries
    .filter((e) => e.entryType === 'amount')
    .reduce((sum, e) => sum + parseMoney(e.amount), 0);

  const isLocked = period.status === 'locked';

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <Link href={`/payroll?week=${weekStart}`}>
        <Button variant="outline" size="sm">
          ← Back to Payroll
        </Button>
      </Link>

      <header className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold text-slate-900">
            {`${employee.firstName} ${employee.lastName}`.trim()}
          </h1>
          <Badge tone={EMPLOYMENT_TYPE_TONE[employmentType]}>
            {EMPLOYMENT_TYPE_LABEL[employmentType]}
          </Badge>
          {isLocked && <Badge tone="slate">Period locked</Badge>}
        </div>
        <p className="text-sm text-slate-500">
          {formatLongDate(workDate)} ·{' '}
          {dayEntries.length}{' '}
          {dayEntries.length === 1 ? 'entry' : 'entries'}
          {totalHours > 0 && (
            <>
              {' · '}
              <strong className="text-slate-900 tabular-nums">
                {totalHours.toFixed(2)}
              </strong>{' '}
              hrs
            </>
          )}
          {totalAmount > 0 && (
            <>
              {' · '}
              <strong className="text-slate-900 tabular-nums">
                {formatMoney(totalAmount)}
              </strong>{' '}
              variable pay
            </>
          )}
        </p>
      </header>

      {dayEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No time logged on this day.</p>
          {allowEdit && !isLocked && (
            <div className="mt-3">
              <Link
                href={`/payroll/entries/new?employeeId=${employeeId}&workDate=${workDate}`}
              >
                <Button size="sm">Add time entry</Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Allocated to</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead className="text-right tabular-nums">Hours</TableHead>
                <TableHead className="text-right tabular-nums">
                  Amount
                </TableHead>
                <TableHead>Notes</TableHead>
                {allowEdit && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dayEntries.map((entry) => {
                const project = entry.projectId
                  ? projectById.get(entry.projectId)
                  : undefined;
                const costCode = entry.costCodeId
                  ? costCodeById.get(entry.costCodeId)
                  : undefined;
                const hours = parseMoney(entry.hours);
                const amount = parseMoney(entry.amount);
                const isAmount = entry.entryType === 'amount';
                return (
                  <TableRow key={entry.id}>
                    <TableCell>
                      {project ? (
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-blue-700 hover:underline"
                        >
                          {project.name}
                        </Link>
                      ) : entry.isOverhead ? (
                        <Badge tone="amber">Overhead</Badge>
                      ) : (
                        <span className="text-slate-500">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {costCode ? (
                        <Link
                          href={`/cost-codes/${costCode.id}`}
                          className="text-blue-700 hover:underline tabular-nums"
                        >
                          {costCode.code} — {costCode.description}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {!isAmount && hours > 0 ? (
                        hours.toFixed(2)
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isAmount && amount > 0 ? (
                        formatMoney(amount)
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600 text-sm">
                      {entry.notes ?? ''}
                    </TableCell>
                    {allowEdit && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/payroll/entries/${entry.id}/edit`}>
                            <Button variant="outline" size="sm">
                              Edit
                            </Button>
                          </Link>
                          {!isLocked && (
                            <DeleteTimeEntryButton entryId={entry.id} />
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {allowEdit && !isLocked && (
            <div className="border-t border-slate-200 p-3 flex justify-end">
              <Link
                href={`/payroll/entries/new?employeeId=${employeeId}&workDate=${workDate}`}
              >
                <Button size="sm">Add entry for this day</Button>
              </Link>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
