import 'server-only';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { getEmployee } from '@/lib/data/employees';
import { getPayPeriod } from '@/lib/data/pay-periods';
import { listTimeEntries } from '@/lib/data/time-entries';
import { listPeriodPayOverrides } from '@/lib/data/period-pay-overrides';
import { listPaystubSnapshots } from '@/lib/data/period-paystub-snapshots';
import { listPaystubAdjustments } from '@/lib/data/paystub-adjustments';
import { listLunchOverrides } from '@/lib/data/timesheet-lunch';
import { computePeriodPaystubs } from '@/modules/payroll/lib/payroll-math';
import { formatPeriodLabel } from '@/modules/payroll/lib/periods';
import { EMPLOYMENT_TYPE_LABEL } from '@/modules/employees/schema';
import type {
  DocumentPayload,
  DocumentMeta,
  DocumentTotalsRow,
} from '@/lib/exports/types';

// The id is a composite `${employeeId}__${payPeriodId}` so a slip is scoped to
// one employee + one pay period. Returns null (→ 404) for an unknown employee /
// period or a period where the employee earned nothing.
export async function buildPayslipPayload(
  companyId: string,
  compositeId: string,
): Promise<DocumentPayload | null> {
  const [employeeId, payPeriodId] = compositeId.split('__');
  if (!employeeId || !payPeriodId) return null;

  const employee = await getEmployee(companyId, employeeId);
  if (!employee) return null;

  const period = await getPayPeriod(companyId, payPeriodId);
  if (!period) return null;
  const [entries, overrides, snapshots, adjustments, lunch] = await Promise.all([
    listTimeEntries(companyId, { payPeriodId: period.id }),
    listPeriodPayOverrides(companyId, { payPeriodId: period.id }),
    listPaystubSnapshots(companyId, { payPeriodId: period.id }),
    listPaystubAdjustments(companyId, { payPeriodId: period.id }),
    listLunchOverrides(companyId, period.id),
  ]);

  const stub = computePeriodPaystubs(
    [employee],
    entries,
    period,
    overrides,
    snapshots,
    adjustments,
    lunch,
  ).find((p) => p.employeeId === employeeId);
  if (!stub || stub.skipped) return null;

  const company = await getActiveCompany();
  const companyInfo = await buildCompanyInfo(company);

  const meta: DocumentMeta[] = [
    { label: 'Pay period', value: formatPeriodLabel(period.startDate, period.endDate) },
    { label: 'Pay type', value: EMPLOYMENT_TYPE_LABEL[stub.employmentType] },
  ];
  if (stub.employmentType === 'hourly') {
    meta.push({ label: 'Rate', value: `${company.defaultCurrency} ${stub.payRate.toFixed(2)}/hr` });
    meta.push({
      label: 'Hours paid',
      value: `${stub.hoursWorked.toFixed(2)}${stub.lunchHours > 0 ? ` (−${stub.lunchHours.toFixed(2)}h lunch)` : ''}`,
    });
    if (stub.overtimeHours > 0)
      meta.push({ label: 'Overtime (1.5×)', value: `${stub.overtimeHours.toFixed(2)} hrs` });
    if (stub.doubleTimeHours > 0)
      meta.push({ label: 'Double time (2×)', value: `${stub.doubleTimeHours.toFixed(2)} hrs` });
  }

  const totals: DocumentTotalsRow[] = [{ label: 'Gross pay', value: stub.gross }];
  for (const d of stub.deductions) {
    totals.push({ label: `Less ${d.description ?? 'deduction'}`, value: d.amount, negative: true });
  }
  if (!stub.nibExempt && stub.nib.employee > 0) {
    totals.push({ label: 'Less NIB (employee 4.65%)', value: stub.nib.employee, negative: true });
  }
  for (const a of stub.additions) {
    const label =
      a.type === 'per_diem' ? 'Per diem' : a.type === 'reimbursement' ? 'Reimbursement' : 'Expense';
    totals.push({ label: a.description ? `${label} — ${a.description}` : label, value: a.amount });
  }
  totals.push({ label: 'Net pay', value: stub.net, bold: true });

  return {
    type: 'payslip',
    title: 'Pay Slip',
    number: `${stub.employeeName.replace(/\s+/g, '-')}-${period.startDate}`,
    statusLabel: period.status === 'locked' ? 'Final' : 'Preview',
    company: companyInfo,
    recipientLabel: 'Employee',
    customer: { name: stub.employeeName },
    meta,
    totals,
    footerNote:
      'NIB withheld at 4.65% (employee). Employer NIB 6.65% is remitted separately and is not deducted from net pay.',
  };
}
