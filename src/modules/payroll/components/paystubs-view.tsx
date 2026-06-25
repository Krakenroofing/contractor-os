// Per-employee paystub for one weekly period. Each card shows:
// gross, optional deductions (pre-NIB), NIB withholding, optional
// reimbursement / per_diem / expense additions (post-NIB), and net.
// Skipped employees (terminated / inactive without time) are surfaced
// separately so it's obvious they were intentionally omitted.

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
} from '@/modules/employees/schema';
import type { EmployeePaystub } from '../lib/payroll-math';
import { NIB_RATES } from '../lib/nib';
import { PaystubOverrideEditor } from './paystub-override-editor';
import { PaystubAdjustmentsEditor } from './paystub-adjustments-editor';

export function PaystubsView({
  paystubs,
  payPeriodId,
  locked,
}: {
  paystubs: EmployeePaystub[];
  payPeriodId: string;
  locked: boolean;
}) {
  const paid = paystubs.filter((p) => !p.skipped);
  const skipped = paystubs.filter((p) => p.skipped);

  if (paystubs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-600">No employees configured yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {paid.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">
            Nobody to pay this period. Add time entries or activate employees.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {paid.map((p) => (
            <PaystubCard
              key={p.employeeId}
              paystub={p}
              payPeriodId={payPeriodId}
              locked={locked}
            />
          ))}
        </div>
      )}

      {skipped.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              Skipped this period
            </p>
            <ul className="space-y-1.5 text-sm">
              {skipped.map((p) => (
                <li
                  key={p.employeeId}
                  className="flex items-center justify-between text-slate-600"
                >
                  <span>{p.employeeName}</span>
                  <span className="text-xs text-slate-500">{p.skipReason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaystubCard({
  paystub: p,
  payPeriodId,
  locked,
}: {
  paystub: EmployeePaystub;
  payPeriodId: string;
  locked: boolean;
}) {
  const ceilingHit = p.adjustedGross > NIB_RATES.weeklyWageCeiling;
  // Rate basis label is contextual to employment type. Hourly = /hr,
  // salaried = /wk, all other types are "per period".
  const rateBasis =
    p.employmentType === 'hourly'
      ? ' / hr'
      : p.employmentType === 'salaried'
        ? ' / wk'
        : ' / period';
  const hasDeductions = p.deductions.length > 0;
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {p.employeeName}
            </h3>
            <div className="mt-1 flex items-center flex-wrap gap-2 text-xs text-slate-500">
              <Badge tone={EMPLOYMENT_TYPE_TONE[p.employmentType]}>
                {EMPLOYMENT_TYPE_LABEL[p.employmentType]}
              </Badge>
              {p.nibExempt && <Badge tone="slate">NIB exempt</Badge>}
              {p.grossSource === 'override' && (
                <Badge tone="blue">Manual gross</Badge>
              )}
              <span className="tabular-nums">
                {formatMoney(p.payRate)}
                {rateBasis}
              </span>
              {p.employmentType === 'hourly' && (
                <span className="tabular-nums">
                  · {p.hoursWorked.toFixed(2)} hrs paid
                  {p.lunchHours > 0 && (
                    <span className="text-slate-400">
                      {' '}
                      (−{p.lunchHours.toFixed(2)}h lunch)
                    </span>
                  )}
                  {p.overtimeHours > 0 && (
                    <span className="text-amber-700">
                      {' '}
                      · {p.overtimeHours.toFixed(2)}h OT
                    </span>
                  )}
                  {p.doubleTimeHours > 0 && (
                    <span className="text-amber-700">
                      {' '}
                      · {p.doubleTimeHours.toFixed(2)}h 2×
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <span className="text-2xl font-semibold tabular-nums text-emerald-700">
            {formatMoney(p.net)}
          </span>
        </header>

        {p.payDescription && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Pay description
            </p>
            <p className="mt-0.5 text-sm text-slate-800 whitespace-pre-wrap">
              {p.payDescription}
            </p>
          </div>
        )}

        <div className="border-t border-slate-200 pt-3 space-y-1.5 text-sm">
          <Line label="Gross pay" amount={p.gross} bold />

          {hasDeductions && (
            <>
              {p.deductions.map((d) => (
                <Line
                  key={d.id}
                  label={
                    d.description
                      ? `Deduction — ${d.description}`
                      : 'Deduction'
                  }
                  amount={-d.amount}
                  negative
                />
              ))}
              <Line
                label="Adjusted gross (post-deduction)"
                amount={p.adjustedGross}
                bold
                muted
              />
            </>
          )}

          {p.nibExempt ? (
            <Line label="NIB exempt — no deductions" amount={0} muted />
          ) : (
            <>
              <Line
                label={`NIB insurable wage${ceilingHit ? ` (capped at $${NIB_RATES.weeklyWageCeiling})` : ''}`}
                amount={p.nib.insurableWage}
                muted
              />
              <Line
                label={`NIB — employee (${(NIB_RATES.employeeRate * 100).toFixed(2)}%)`}
                amount={-p.nib.employee}
                negative
              />
            </>
          )}

          {p.additions.map((a) => (
            <Line
              key={a.id}
              label={
                a.description
                  ? `${labelForAdditionType(a.type)} — ${a.description}`
                  : labelForAdditionType(a.type)
              }
              amount={a.amount}
              accent="emerald"
            />
          ))}

          <Line label="Net pay" amount={p.net} bold accent="emerald" />
        </div>

        {!p.nibExempt && (
          <div className="border-t border-slate-200 pt-3 text-xs text-slate-500 flex items-center justify-between">
            <span>
              Employer NIB ({(NIB_RATES.employerRate * 100).toFixed(2)}%,
              company-paid)
            </span>
            <span className="tabular-nums">{formatMoney(p.nib.employer)}</span>
          </div>
        )}

        <div className="border-t border-slate-200 pt-3 space-y-2">
          <PaystubAdjustmentsEditor
            employeeId={p.employeeId}
            payPeriodId={payPeriodId}
            deductions={p.deductions}
            additions={p.additions}
            locked={locked}
          />
          {!locked && (
            <PaystubOverrideEditor
              employeeId={p.employeeId}
              payPeriodId={payPeriodId}
              currentGross={p.gross}
              currentNotes={p.payDescription}
              hasOverride={p.grossSource === 'override'}
            />
          )}
          <a
            href={`/api/exports/payslip/${p.employeeId}__${payPeriodId}/pdf`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center text-xs font-medium text-blue-700 hover:underline"
          >
            Download pay slip (PDF) ↓
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function labelForAdditionType(type: 'reimbursement' | 'per_diem' | 'expense' | 'deduction'): string {
  if (type === 'reimbursement') return 'Reimbursement';
  if (type === 'per_diem') return 'Per diem';
  if (type === 'expense') return 'Expense';
  return 'Adjustment';
}

function Line({
  label,
  amount,
  bold,
  muted,
  negative,
  accent,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  muted?: boolean;
  negative?: boolean;
  accent?: 'emerald';
}) {
  const cn = [
    'flex items-center justify-between tabular-nums gap-3',
    bold ? 'font-semibold' : '',
    muted ? 'text-slate-500' : 'text-slate-700',
    negative ? 'text-red-600' : '',
    accent === 'emerald' && !negative ? 'text-emerald-700' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="whitespace-nowrap">
        {negative && amount !== 0 ? '−' : accent === 'emerald' && amount > 0 && !bold ? '+' : ''}
        {formatMoney(Math.abs(amount))}
      </span>
    </div>
  );
}
