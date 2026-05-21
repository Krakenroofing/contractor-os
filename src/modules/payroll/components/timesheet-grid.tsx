// Server-rendered timesheet grid: rows = employees, columns = days of the
// week. Each cell shows what that employee logged that day — hours for
// hourly / salaried employees, $ amount for piecework / contract /
// commission / lump-sum employees. Same grid, two units. Click any cell
// to open the entry form pre-filled with the employee + date so the
// flow stays a single tap.

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
  /** 'hours' → cells render as 8.00; 'money' → cells render as $X.XX. */
  valueUnit: 'hours' | 'money';
  /** Map work_date → that day's value (hours or money depending on unit). */
  valueByDate: Record<string, number>;
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
            const total = days.reduce(
              (a, d) => a + (emp.valueByDate[d] ?? 0),
              0,
            );
            const renderValue = (v: number) =>
              emp.valueUnit === 'hours' ? v.toFixed(2) : formatMoney(v);
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
                  const v = emp.valueByDate[d] ?? 0;
                  return (
                    <TableCell key={d} className="text-right">
                      {allowEdit && !locked ? (
                        <Link
                          href={`/payroll/entries/new?employeeId=${emp.id}&workDate=${d}`}
                          className="block w-full text-right tabular-nums hover:text-blue-700"
                        >
                          {v > 0 ? (
                            renderValue(v)
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </Link>
                      ) : (
                        <span className="tabular-nums text-slate-600">
                          {v > 0 ? renderValue(v) : '—'}
                        </span>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right tabular-nums font-semibold">
                  {total > 0 ? renderValue(total) : '—'}
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
