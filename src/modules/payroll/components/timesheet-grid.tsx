// Server-rendered timesheet grid: rows = employees, columns = days of the
// week. Each cell shows the total hours that employee worked that day and
// links to an "add entry" form pre-filled with the employee + date so the
// click-from-cell flow is a single tap. Right column = weekly total per
// employee. Bottom row = daily total across all employees.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDayLabel } from '@/modules/payroll/lib/periods';

export type TimesheetEmployee = {
  id: string;
  fullName: string;
  // Map work_date → total hours for that day. Days with no entries are absent.
  hoursByDate: Record<string, number>;
};

export function TimesheetGrid({
  days,
  employees,
  weekStart,
  allowEdit,
  locked,
}: {
  days: string[];
  employees: TimesheetEmployee[];
  weekStart: string;
  allowEdit: boolean;
  locked: boolean;
}) {
  if (employees.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-600">No active employees.</p>
        <p className="text-sm text-slate-500 mt-1">
          Add employees from the{' '}
          <Link href="/employees" className="text-blue-600 hover:underline">
            Employees
          </Link>{' '}
          tab first.
        </p>
      </div>
    );
  }

  // Column totals (per day, across all employees).
  const dailyTotals: Record<string, number> = {};
  for (const d of days) dailyTotals[d] = 0;
  for (const e of employees) {
    for (const d of days) {
      dailyTotals[d] += e.hoursByDate[d] ?? 0;
    }
  }
  const grandTotal = Object.values(dailyTotals).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Employee</TableHead>
            {days.map((d) => (
              <TableHead key={d} className="text-right tabular-nums">
                {formatDayLabel(d)}
              </TableHead>
            ))}
            <TableHead className="text-right tabular-nums font-semibold">
              Total
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((emp) => {
            const total = days.reduce(
              (a, d) => a + (emp.hoursByDate[d] ?? 0),
              0,
            );
            return (
              <TableRow key={emp.id}>
                <TableCell className="font-medium text-slate-900">
                  {emp.fullName}
                </TableCell>
                {days.map((d) => {
                  const h = emp.hoursByDate[d] ?? 0;
                  return (
                    <TableCell key={d} className="text-right">
                      {allowEdit && !locked ? (
                        <Link
                          href={`/payroll/entries/new?employeeId=${emp.id}&workDate=${d}`}
                          className="block w-full text-right tabular-nums hover:text-blue-700"
                        >
                          {h > 0 ? (
                            h.toFixed(2)
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </Link>
                      ) : (
                        <span className="tabular-nums text-slate-600">
                          {h > 0 ? h.toFixed(2) : '—'}
                        </span>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right tabular-nums font-semibold">
                  {total > 0 ? total.toFixed(2) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-slate-50">
            <TableCell className="font-semibold text-slate-700">
              Daily total
            </TableCell>
            {days.map((d) => (
              <TableCell key={d} className="text-right tabular-nums font-semibold">
                {dailyTotals[d] > 0 ? dailyTotals[d].toFixed(2) : '—'}
              </TableCell>
            ))}
            <TableCell className="text-right tabular-nums font-bold text-slate-900">
              {grandTotal > 0 ? grandTotal.toFixed(2) : '—'}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {allowEdit && !locked && (
        <div className="border-t border-slate-200 p-3 flex justify-end">
          <Link href={`/payroll/entries/new?workDate=${weekStart}`}>
            <Button size="sm">Add time entry</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
