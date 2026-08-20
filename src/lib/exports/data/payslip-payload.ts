import 'server-only';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { getEmployee } from '@/lib/data/employees';
import { getPayPeriod } from '@/lib/data/pay-periods';
import { listTimeEntries } from '@/lib/data/time-entries';
import { listProjects } from '@/lib/data/projects';
import { listPeriodPayOverrides } from '@/lib/data/period-pay-overrides';
import { listPaystubSnapshots } from '@/lib/data/period-paystub-snapshots';
import { listPaystubAdjustments } from '@/lib/data/paystub-adjustments';
import { listLunchOverrides } from '@/lib/data/timesheet-lunch';
import { computePeriodPaystubs } from '@/modules/payroll/lib/payroll-math';
import { formatPeriodLabel } from '@/modules/payroll/lib/periods';
import { EMPLOYMENT_TYPE_LABEL } from '@/modules/employees/schema';
import { ADJUSTMENT_TYPE_LABEL } from '@/db/schema/paystub-adjustments';
import type {
  DocumentPayload,
  DocumentDataTable,
  DocumentMeta,
  DocumentSection,
  DocumentTotalsRow,
} from '@/lib/exports/types';

/** 'YYYY-MM-DD' → "Mon, Jun 1" (UTC math, same as the periods helpers). */
function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const month = dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${weekday}, ${month} ${dt.getUTCDate()}`;
}

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

  const totals: DocumentTotalsRow[] = [];
  // Itemize the gross into base wages + each piece-work line (with its job +
  // note) when piece-work pay is folded in, so the slip explains the total.
  // Base-only stubs just show a single gross line.
  if (stub.pieceWork > 0) {
    const projectNames = new Map(
      (await listProjects(companyId)).map((p) => [p.id, p.name]),
    );
    if (stub.baseWage > 0) {
      totals.push({ label: 'Base pay (rate / salary)', value: stub.baseWage });
    }
    if (stub.pieceWorkLines.length > 0) {
      for (const pw of stub.pieceWorkLines) {
        const job = pw.projectId ? projectNames.get(pw.projectId) : undefined;
        let label = 'Piece work';
        if (job) label += ` — ${job}`;
        if (pw.notes && pw.notes.trim() !== '') label += ` (${pw.notes.trim()})`;
        totals.push({ label, value: pw.amount });
      }
    } else {
      totals.push({ label: 'Piece work', value: stub.pieceWork });
    }
    totals.push({ label: 'Gross pay', value: stub.gross, bold: true });
  } else {
    totals.push({ label: 'Gross pay', value: stub.gross });
  }
  for (const d of stub.deductions) {
    totals.push({ label: `Less ${d.description ?? 'deduction'}`, value: d.amount, negative: true });
  }
  if (!stub.nibExempt && stub.nib.employee > 0) {
    totals.push({ label: 'Less NIB (employee 4.65%)', value: stub.nib.employee, negative: true });
  }
  for (const a of stub.additions) {
    const label = ADJUSTMENT_TYPE_LABEL[a.type] ?? 'Addition';
    totals.push({ label: a.description ? `${label} — ${a.description}` : label, value: a.amount });
  }
  totals.push({ label: 'Net pay', value: stub.net, bold: true });

  // Day-by-day hours table. Tier columns (straight / 1.5× / 2×) only appear
  // when the overtime engine actually classified something beyond straight
  // time — an all-straight week just shows Day / Hours. The Notes column
  // appears only when at least one day carries a time-entry note.
  const dataTables: DocumentDataTable[] = [];
  const dayLines = stub.dayLines;
  if (dayLines.length > 0) {
    const hasTiers = dayLines.some((d) => d.overtime > 0 || d.doubleTime > 0);
    const hasNotes = dayLines.some((d) => d.notes);
    const hrs = (n: number) => (n > 0 ? n.toFixed(2) : '');

    const columns: DocumentDataTable['columns'] = [
      { label: 'Day', align: 'left', widthPct: hasNotes ? 18 : 30 },
    ];
    if (hasTiers) {
      columns.push(
        { label: 'Straight', align: 'right', widthPct: 12 },
        { label: 'OT (1.5×)', align: 'right', widthPct: 12 },
        { label: 'Double (2×)', align: 'right', widthPct: 12 },
      );
    }
    columns.push({ label: 'Hours', align: 'right', widthPct: 12 });
    if (hasNotes) columns.push({ label: 'Notes', align: 'left' });

    const rows = dayLines.map((d) => {
      const row = [formatDay(d.date)];
      if (hasTiers)
        row.push(hrs(d.regular), hrs(d.overtime), hrs(d.doubleTime));
      row.push(d.hours.toFixed(2));
      if (hasNotes) row.push(d.notes ?? '');
      return row;
    });
    const sum = (pick: (d: (typeof dayLines)[number]) => number) =>
      dayLines.reduce((s, d) => s + pick(d), 0);
    const totalRow = ['Total'];
    if (hasTiers)
      totalRow.push(
        hrs(sum((d) => d.regular)),
        hrs(sum((d) => d.overtime)),
        hrs(sum((d) => d.doubleTime)),
      );
    totalRow.push(sum((d) => d.hours).toFixed(2));
    if (hasNotes) totalRow.push('');
    rows.push(totalRow);

    dataTables.push({
      title:
        stub.lunchHours > 0
          ? `Hours by day (paid hours, after −${stub.lunchHours.toFixed(2)}h unpaid lunch)`
          : 'Hours by day',
      columns,
      rows,
    });
  }

  // The period pay override's memo ("what this pay covers") prints as a
  // prose section — it's the operator's note to the employee.
  const sections: DocumentSection[] = [];
  if (stub.payDescription && stub.payDescription.trim() !== '') {
    sections.push({ title: 'Pay note', body: stub.payDescription.trim() });
  }

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
    dataTables: dataTables.length > 0 ? dataTables : undefined,
    sections: sections.length > 0 ? sections : undefined,
    footerNote:
      'NIB withheld at 4.65% (employee). Employer NIB 6.65% is remitted separately and is not deducted from net pay.',
  };
}
