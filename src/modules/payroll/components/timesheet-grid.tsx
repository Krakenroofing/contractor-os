// Server-rendered timesheet grid: rows = employees, columns = days of the
// week. The grid is a record of HOURS for everyone. Variable-pay workers
// (contract / piecework / commission / lump-sum) also show the day's $
// pay beneath the hours, since their gross is the sum of those daily
// amounts. Click any populated cell for the day breakdown, or an empty
// cell to add an entry pre-filled with the employee + date.

import Link from 'next/link';
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
import { formatMoney } from '@/lib/money';
import { formatDayLabel } from '@/modules/payroll/lib/periods';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
  type EmploymentType,
} from '@/modules/employees/schema';

export type TimesheetEmployee = {
  id: string;
  fullName: string;
  employmentType: EmploymentType;
  /** Variable-pay types show a $ pay line under the hours in each cell. */
  isVariablePay: boolean;
  /** Map work_date → hours logged that day (the record, for everyone). */
  hoursByDate: Record<string, number>;
  /** Map work_date → $ pay logged that day (variable-pay workers only). */
  payByDate: Record<string, number>;
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

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[220px]">Employee</TableHead>
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
            const totalHours = days.reduce(
              (a, d) => a + (emp.hoursByDate[d] ?? 0),
              0,
            );
            const totalPay = days.reduce(
              (a, d) => a + (emp.payByDate[d] ?? 0),
              0,
            );
            return (
              <TableRow key={emp.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {emp.fullName}
                    </span>
                    <Badge tone={EMPLOYMENT_TYPE_TONE[emp.employmentType]}>
                      {EMPLOYMENT_TYPE_LABEL[emp.employmentType]}
                    </Badge>
                  </div>
                </TableCell>
                {days.map((d) => {
                  const hours = emp.hoursByDate[d] ?? 0;
                  const pay = emp.payByDate[d] ?? 0;
                  const populated = hours > 0 || pay > 0;
                  const cellBody = (
                    <DayCell
                      hours={hours}
                      pay={pay}
                      showPay={emp.isVariablePay}
                    />
                  );
                  // Populated → day-detail breakdown (read-only, works even
                  // when locked). Empty + editable → quick-add entry form.
                  if (populated) {
                    return (
                      <TableCell key={d} className="text-right align-top">
                        <Link
                          href={`/payroll/day?employeeId=${emp.id}&workDate=${d}`}
                          className="block w-full hover:text-blue-700"
                        >
                          {cellBody}
                        </Link>
                      </TableCell>
                    );
                  }
                  if (allowEdit && !locked) {
                    return (
                      <TableCell key={d} className="text-right align-top">
                        <Link
                          href={`/payroll/entries/new?employeeId=${emp.id}&workDate=${d}`}
                          className="block w-full hover:text-blue-700"
                        >
                          {cellBody}
                        </Link>
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={d} className="text-right align-top">
                      {cellBody}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right align-top font-semibold">
                  <DayCell
                    hours={totalHours}
                    pay={totalPay}
                    showPay={emp.isVariablePay}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {allowEdit && !locked && (
        <div className="border-t border-slate-200 p-3 flex justify-end">
          <Link href={`/payroll/entries/new?workDate=${weekStart}`}>
            <Button size="sm">Add entry</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * One day's cell: hours on top (the record, for everyone), with the day's
 * $ pay beneath it for variable-pay workers. An em-dash when nothing is
 * logged. Hours always render with an 'h' suffix so they can't be misread
 * as dollars (the bug this grid had: contract hours shown as "$9.65").
 */
function DayCell({
  hours,
  pay,
  showPay,
}: {
  hours: number;
  pay: number;
  showPay: boolean;
}) {
  if (hours <= 0 && pay <= 0) {
    return <span className="text-slate-300 tabular-nums">—</span>;
  }
  return (
    <div className="leading-tight">
      <div className="tabular-nums text-slate-900">
        {hours > 0 ? `${hours.toFixed(2)}h` : <span className="text-slate-300">—</span>}
      </div>
      {showPay && pay > 0 && (
        <div className="tabular-nums text-xs text-emerald-700">
          {formatMoney(pay)}
        </div>
      )}
    </div>
  );
}
