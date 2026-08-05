import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildNibMonthlyReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';
import { NIB_RATES, nibCeilingForDate } from '@/modules/payroll/lib/nib';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
} from '@/modules/employees/schema';

export const dynamic = 'force-dynamic';

export default async function NibMonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'payroll')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildNibMonthlyReport(company.id, filters),
    listProjects(company.id),
  ]);

  // If the user didn't pick a date range, surface the snapped month in
  // the filter pills above (so "From / To" reflects the actual window
  // the report is reading).
  const effectiveFilters = {
    ...filters,
    from: filters.from || report.monthStart,
    to: filters.to || report.monthEnd,
  };

  // Insurable-wage ceiling in force for this report month (date-dependent —
  // e.g. the 2026-07-01 increase to $830/week).
  const nibCeiling = nibCeilingForDate(report.monthStart);

  return (
    <ReportShell
      type="nib-monthly"
      filters={effectiveFilters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <Card className="border-slate-300">
        <CardHeader>
          <CardTitle>{report.monthLabel} — C-10 (Non-Hospitality)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-500 mb-4">
            Rates as of {NIB_RATES.effectiveAsOf}: employee{' '}
            {(NIB_RATES.employeeRate * 100).toFixed(2)}% / employer{' '}
            {(NIB_RATES.employerRate * 100).toFixed(2)}% on insurable wages
            up to ${nibCeiling.weeklyWageCeiling}/week ($
            {nibCeiling.monthlyWageCeiling}/month). Pay periods are
            bucketed into this month by their <strong>end date</strong>.
            NIB-exempt employees are excluded from the C-10 totals.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KPI
              label="Weeks in month"
              value={String(report.totals.weeksInMonth)}
              hint={
                report.weeks.length === 0
                  ? 'No pay periods'
                  : `${report.weeks[0].startDate} → ${report.weeks[report.weeks.length - 1].endDate}`
              }
            />
            <KPI
              label="Employees on payroll"
              value={String(report.totals.headcount)}
            />
            <KPI
              label="Total gross wages"
              value={formatMoney(report.totals.totalGross)}
              hint="Post-deduction"
            />
            <KPI
              label="Total insurable wages"
              value={formatMoney(report.totals.totalInsurableWage)}
              hint={`Capped at $${nibCeiling.weeklyWageCeiling}/wk per employee`}
            />
            <KPI
              label="Employee NIB withheld"
              value={formatMoney(report.totals.totalEmployee)}
              valueClassName="text-red-700"
            />
            <KPI
              label="Employer NIB owed"
              value={formatMoney(report.totals.totalEmployer)}
              valueClassName="text-red-700"
            />
          </div>
          <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-emerald-700">
                Total NIB remittance — {report.monthLabel}
              </p>
              <p className="mt-0.5 text-xs text-emerald-700/80">
                Employee {formatMoney(report.totals.totalEmployee)} + Employer{' '}
                {formatMoney(report.totals.totalEmployer)}
              </p>
            </div>
            <p className="text-3xl font-bold tabular-nums text-emerald-800">
              {formatMoney(report.totals.totalRemittance)}
            </p>
          </div>
        </CardContent>
      </Card>

      {report.employees.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-slate-600">
              No NIB-eligible payroll activity for {report.monthLabel}.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Pay periods ending between {report.monthStart} and{' '}
              {report.monthEnd} are aggregated here. Lock the weekly
              periods before filing.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Per-employee monthly detail</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Weeks</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Insurable</TableHead>
                    <TableHead className="text-right">Employee NIB</TableHead>
                    <TableHead className="text-right">Employer NIB</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.employees.map((e) => (
                    <TableRow key={e.employeeId}>
                      <TableCell className="font-medium text-slate-900">
                        {e.employeeName}
                      </TableCell>
                      <TableCell>
                        <Badge tone={EMPLOYMENT_TYPE_TONE[e.employmentType]}>
                          {EMPLOYMENT_TYPE_LABEL[e.employmentType]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {e.weekCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatMoney(e.adjustedGross)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(e.insurableWage)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-700">
                        {formatMoney(e.employeeNib)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-700">
                        {formatMoney(e.employerNib)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-emerald-700">
                        {formatMoney(e.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot className="bg-slate-50 font-semibold">
                  <tr>
                    <td className="px-4 py-2.5 text-slate-700" colSpan={3}>
                      Totals
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMoney(report.totals.totalGross)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMoney(report.totals.totalInsurableWage)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-700">
                      {formatMoney(report.totals.totalEmployee)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-700">
                      {formatMoney(report.totals.totalEmployer)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                      {formatMoney(
                        report.totals.totalGross - report.totals.totalEmployee,
                      )}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Weekly breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Headcount</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Insurable</TableHead>
                    <TableHead className="text-right">Employee NIB</TableHead>
                    <TableHead className="text-right">Employer NIB</TableHead>
                    <TableHead className="text-right">Remittance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.weeks.map((w) => (
                    <TableRow key={w.payPeriodId}>
                      <TableCell className="font-medium text-slate-900 whitespace-nowrap">
                        {w.startDate} → {w.endDate}
                      </TableCell>
                      <TableCell>
                        {w.status === 'locked' ? (
                          <Badge tone="green">Locked</Badge>
                        ) : (
                          <Badge tone="amber">Open</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {w.headcount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(w.totalGross)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(w.totalInsurableWage)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-700">
                        {formatMoney(w.totalEmployee)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-700">
                        {formatMoney(w.totalEmployer)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-emerald-700">
                        {formatMoney(w.totalRemittance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </ReportShell>
  );
}

function KPI({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}
