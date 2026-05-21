// Company-wide aggregate matching what gets filed on the NIB C17 form.
// One big number block per line item so the person filing can read it
// straight across to the form fields.

import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import type { C17Summary, EmployeePaystub } from '../lib/payroll-math';
import { NIB_RATES } from '../lib/nib';

export function C17SummaryView({
  summary,
  paystubs,
  periodLabel,
}: {
  summary: C17Summary;
  paystubs: EmployeePaystub[];
  periodLabel: string;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6 space-y-4">
          <header>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              NIB C17 — {periodLabel}
            </p>
            <h2 className="text-xl font-semibold text-slate-900 mt-0.5">
              Contribution summary
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Rates as of {NIB_RATES.effectiveAsOf}: employee{' '}
              {(NIB_RATES.employeeRate * 100).toFixed(1)}% / employer{' '}
              {(NIB_RATES.employerRate * 100).toFixed(1)}% on insurable wages
              up to ${NIB_RATES.weeklyWageCeiling}/week.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Stat label="Employees on payroll" value={String(summary.headcount)} />
            <Stat
              label="Total gross wages"
              value={formatMoney(summary.totalGross)}
            />
            <Stat
              label="Total insurable wages"
              value={formatMoney(summary.totalInsurableWage)}
              hint="Gross capped at $710/employee/week"
            />
            <Stat
              label="Employee NIB withheld"
              value={formatMoney(summary.totalEmployee)}
              accent="red"
            />
            <Stat
              label="Employer NIB owed"
              value={formatMoney(summary.totalEmployer)}
              accent="red"
            />
            <Stat
              label="Total NIB remittance"
              value={formatMoney(summary.totalRemittance)}
              accent="emerald"
              hint="Employee + employer · what you pay NIB this period"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-900">
              Per-employee detail
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Snapshot of every row that contributed to the totals above.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-6 py-2.5 font-medium">
                    Employee
                  </th>
                  <th className="text-right px-3 py-2.5 font-medium">Gross</th>
                  <th className="text-right px-3 py-2.5 font-medium">
                    Insurable
                  </th>
                  <th className="text-right px-3 py-2.5 font-medium">
                    Employee NIB
                  </th>
                  <th className="text-right px-3 py-2.5 font-medium">
                    Employer NIB
                  </th>
                  <th className="text-right px-6 py-2.5 font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paystubs
                  .filter((p) => !p.skipped && p.gross > 0)
                  .map((p) => (
                    <tr key={p.employeeId}>
                      <td className="px-6 py-2 font-medium text-slate-900">
                        {p.employeeName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatMoney(p.gross)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {formatMoney(p.nib.insurableWage)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">
                        {formatMoney(p.nib.employee)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">
                        {formatMoney(p.nib.employer)}
                      </td>
                      <td className="px-6 py-2 text-right tabular-nums font-medium text-emerald-700">
                        {formatMoney(p.net)}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold">
                <tr>
                  <td className="px-6 py-2.5 text-slate-700">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(summary.totalGross)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(summary.totalInsurableWage)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                    {formatMoney(summary.totalEmployee)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                    {formatMoney(summary.totalEmployer)}
                  </td>
                  <td className="px-6 py-2.5 text-right tabular-nums text-emerald-700">
                    {formatMoney(
                      summary.totalGross - summary.totalEmployee,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: 'red' | 'emerald';
}) {
  const valueClass =
    accent === 'red'
      ? 'text-red-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : 'text-slate-900';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
