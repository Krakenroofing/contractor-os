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
import { buildPayrollSummaryReport } from '@/modules/reports/lib/reports';
import { ReportShell } from '@/modules/reports/components/report-shell';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
} from '@/modules/employees/schema';
import { ADJUSTMENT_TYPE_LABEL } from '@/db/schema';

export const dynamic = 'force-dynamic';

export default async function PayrollSummaryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'payroll')) redirect('/dashboard');
  const company = await getActiveCompany();
  const filters = parseReportFilters(await searchParams);
  const [report, projects] = await Promise.all([
    buildPayrollSummaryReport(company.id, filters),
    listProjects(company.id),
  ]);

  // Reflect the snapped current-month default in the filter pills.
  const effectiveFilters = {
    ...filters,
    from: filters.from || report.windowStart,
    to: filters.to || report.windowEnd,
  };

  const t = report.totals;

  return (
    <ReportShell
      type="payroll-summary"
      filters={effectiveFilters}
      projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      companyName={company.name}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI
          label="Employees paid"
          value={String(t.headcount)}
          hint={`${report.weekCount} weekly period(s)`}
        />
        <KPI label="Hours worked" value={t.hoursWorked.toFixed(2)} />
        <KPI
          label="Gross pay"
          value={formatMoney(t.gross)}
          hint="Pre-deduction"
        />
        <KPI
          label="Adjusted gross"
          value={formatMoney(t.adjustedGross)}
          hint={
            t.deductionsTotal > 0
              ? `After ${formatMoney(t.deductionsTotal)} in deductions`
              : 'No deductions'
          }
        />
        <KPI
          label="Total net paid"
          value={formatMoney(t.net)}
          valueClassName="text-emerald-700"
          hint="To employees"
        />
        <KPI
          label="Total labor cost"
          value={formatMoney(t.totalLaborCost)}
          valueClassName="text-amber-700"
          hint="Adj. gross + employer NIB + additions"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SmallStat
          label="Employee NIB withheld"
          value={formatMoney(t.employeeNib)}
          accent="red"
        />
        <SmallStat
          label="Employer NIB owed"
          value={formatMoney(t.employerNib)}
          accent="red"
        />
        <SmallStat
          label="Deductions (pre-NIB)"
          value={formatMoney(t.deductionsTotal)}
          accent="red"
        />
        <SmallStat
          label="Reimbursements + per diem + expenses"
          value={formatMoney(t.additionsTotal)}
          accent="emerald"
          hint={`Reim ${formatMoney(t.reimbursements)} · PD ${formatMoney(t.perDiem)} · Exp ${formatMoney(t.expenses)}`}
        />
      </div>

      {report.employees.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-slate-600">
              No payroll activity for {report.windowStart} → {report.windowEnd}.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Pay periods are bucketed by end date. Adjust the range above to
              widen the window.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Per-employee detail</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Weeks</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Adj. gross</TableHead>
                    <TableHead className="text-right">Empl. NIB</TableHead>
                    <TableHead className="text-right">Reim/PD/Exp</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Empr. NIB</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.employees.map((e) => (
                    <TableRow key={e.employeeId}>
                      <TableCell className="font-medium text-slate-900 whitespace-nowrap">
                        {e.employeeName}
                        {e.nibExempt && (
                          <Badge tone="slate" className="ml-2">
                            NIB exempt
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge tone={EMPLOYMENT_TYPE_TONE[e.employmentType]}>
                          {EMPLOYMENT_TYPE_LABEL[e.employmentType]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {e.weekCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {e.hoursWorked > 0 ? e.hoursWorked.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatMoney(e.gross)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">
                        {e.deductionsTotal > 0
                          ? `−${formatMoney(e.deductionsTotal)}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatMoney(e.adjustedGross)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-700">
                        {e.employeeNib > 0
                          ? `−${formatMoney(e.employeeNib)}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {e.additionsTotal > 0
                          ? `+${formatMoney(e.additionsTotal)}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-emerald-700">
                        {formatMoney(e.net)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-500">
                        {e.employerNib > 0 ? formatMoney(e.employerNib) : '—'}
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
                      {t.hoursWorked > 0 ? t.hoursWorked.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMoney(t.gross)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-600">
                      {t.deductionsTotal > 0
                        ? `−${formatMoney(t.deductionsTotal)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMoney(t.adjustedGross)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-700">
                      −{formatMoney(t.employeeNib)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                      {t.additionsTotal > 0
                        ? `+${formatMoney(t.additionsTotal)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                      {formatMoney(t.net)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {formatMoney(t.employerNib)}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            </CardContent>
          </Card>

          {report.adjustments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Adjustment line items</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Every deduction / reimbursement / per diem / expense
                  that landed on a paystub in this window. Deductions
                  reduce gross before NIB; the others are added to net
                  post-NIB.
                </p>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week ending</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.adjustments.map((a, idx) => {
                      const isDeduction = a.type === 'deduction';
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-slate-600 whitespace-nowrap">
                            {a.payPeriodEnd}
                          </TableCell>
                          <TableCell className="font-medium text-slate-900 whitespace-nowrap">
                            {a.employeeName}
                          </TableCell>
                          <TableCell>
                            <Badge
                              tone={isDeduction ? 'red' : 'green'}
                            >
                              {ADJUSTMENT_TYPE_LABEL[a.type]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-700">
                            {a.description ?? '—'}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums font-medium ${
                              isDeduction ? 'text-red-600' : 'text-emerald-700'
                            }`}
                          >
                            {isDeduction ? '−' : '+'}
                            {formatMoney(a.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
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

function SmallStat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: 'red' | 'emerald';
  hint?: string;
}) {
  const cls =
    accent === 'red'
      ? 'text-red-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : 'text-slate-900';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${cls}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
