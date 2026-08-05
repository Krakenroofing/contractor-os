// "Where this period's labor went" — the payroll-side view of the labor →
// job-costing allocation. Shows the per-project split (wages + employer NIB)
// that Post labor writes to job_cost_entries, the pay that stays OFF job
// costing (salary/overhead with no job-tagged time), and whether the posting
// on record still matches the timesheet. Server component — pure props.

import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type LaborAllocationProjectRow = {
  projectId: string;
  projectName: string;
  employees: string[];
  wage: number;
  burden: number;
};

export type LaborAllocationUnpostedRow = {
  employeeName: string;
  amount: number;
  /** True when the employee logged time but none of it is job-tagged
   *  (overhead/yard); false when there's no logged time at all (salary). */
  hasTime: boolean;
};

export function LaborAllocationPanel({
  rows,
  unposted,
  locked,
  postedCount,
  postedWage,
  postedBurden,
  drift,
}: {
  rows: LaborAllocationProjectRow[];
  unposted: LaborAllocationUnpostedRow[];
  locked: boolean;
  /** Number of labor job-cost lines currently on record for this period. */
  postedCount: number;
  postedWage: number;
  postedBurden: number;
  drift: boolean;
}) {
  const isPosted = postedCount > 0;
  const totalWage = rows.reduce((s, r) => s + r.wage, 0);
  const totalBurden = rows.reduce((s, r) => s + r.burden, 0);
  const totalUnposted = unposted.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="rounded-lg border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-medium text-slate-700">
            Where this period&apos;s labor went
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Wages + employer NIB split across the jobs each person logged time
            to. The same lines appear on each project&apos;s Job Costing page.
          </p>
        </div>
        {isPosted ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            Posted · {formatMoney(postedWage)} wages +{' '}
            {formatMoney(postedBurden)} burden
          </span>
        ) : locked ? (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Not posted yet
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            Preview — updates with the timesheet
          </span>
        )}
      </div>

      {drift && (
        <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          The timesheet has changed since labor was posted — the job-costing
          lines on record don&apos;t match this allocation anymore. Re-post
          below to update them.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          No job-tagged time this period yet — nothing to allocate.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Crew</TableHead>
              <TableHead className="text-right">Wages</TableHead>
              <TableHead className="text-right">NIB burden</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.projectId}>
                <TableCell className="font-medium text-slate-900">
                  <Link
                    href={{ pathname: `/job-costing/${r.projectId}` }}
                    className="hover:underline"
                  >
                    {r.projectName}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {r.employees.join(', ')}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(r.wage)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-600">
                  {formatMoney(r.burden)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatMoney(r.wage + r.burden)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium text-slate-900">
                Total to jobs
              </TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums font-semibold">
                {formatMoney(totalWage)}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {formatMoney(totalBurden)}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {formatMoney(totalWage + totalBurden)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}

      {unposted.length > 0 && (
        <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 space-y-1">
          <p className="font-medium">
            Not job-costed ({formatMoney(totalUnposted)}) — stays on the
            P&amp;L as company payroll:
          </p>
          <ul className="space-y-0.5">
            {unposted.map((u) => (
              <li key={u.employeeName} className="flex justify-between gap-3">
                <span>
                  {u.employeeName}
                  <span className="text-slate-500">
                    {' '}
                    — {u.hasTime ? 'time not tagged to a job' : 'no logged time (salary)'}
                  </span>
                </span>
                <span className="tabular-nums">{formatMoney(u.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
