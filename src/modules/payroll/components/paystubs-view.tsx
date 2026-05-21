// Per-employee paystub for one weekly period. Each card shows:
// hours, gross, employee NIB (deducted), employer NIB (company-paid),
// net. Skipped employees (terminated / inactive without time) are
// surfaced separately so it's obvious they were intentionally omitted.

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
} from '@/modules/employees/schema';
import type { EmployeePaystub } from '../lib/payroll-math';
import { NIB_RATES } from '../lib/nib';

export function PaystubsView({ paystubs }: { paystubs: EmployeePaystub[] }) {
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
            <PaystubCard key={p.employeeId} paystub={p} />
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

function PaystubCard({ paystub: p }: { paystub: EmployeePaystub }) {
  const ceilingHit = p.gross > NIB_RATES.weeklyWageCeiling;
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {p.employeeName}
            </h3>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <Badge tone={EMPLOYMENT_TYPE_TONE[p.employmentType]}>
                {EMPLOYMENT_TYPE_LABEL[p.employmentType]}
              </Badge>
              <span className="tabular-nums">
                {formatMoney(p.payRate)}
                {p.employmentType === 'hourly' ? ' / hr' : ' / wk'}
              </span>
              {p.employmentType === 'hourly' && (
                <span className="tabular-nums">
                  · {p.hoursWorked.toFixed(2)} hrs
                </span>
              )}
            </div>
          </div>
          <span className="text-2xl font-semibold tabular-nums text-emerald-700">
            {formatMoney(p.net)}
          </span>
        </header>

        <div className="border-t border-slate-200 pt-3 space-y-1.5 text-sm">
          <Line label="Gross pay" amount={p.gross} bold />
          <Line
            label={`NIB insurable wage${ceilingHit ? ' (capped at $710)' : ''}`}
            amount={p.nib.insurableWage}
            muted
          />
          <Line
            label="NIB — employee (3.9%)"
            amount={-p.nib.employee}
            negative
          />
          <Line label="Net pay" amount={p.net} bold accent="emerald" />
        </div>

        <div className="border-t border-slate-200 pt-3 text-xs text-slate-500 flex items-center justify-between">
          <span>Employer NIB (5.9%, company-paid)</span>
          <span className="tabular-nums">{formatMoney(p.nib.employer)}</span>
        </div>
      </CardContent>
    </Card>
  );
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
    'flex items-center justify-between tabular-nums',
    bold ? 'font-semibold' : '',
    muted ? 'text-slate-500' : 'text-slate-700',
    negative ? 'text-red-600' : '',
    accent === 'emerald' ? 'text-emerald-700' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn}>
      <span>{label}</span>
      <span>
        {negative && amount !== 0 ? '−' : ''}
        {formatMoney(Math.abs(amount))}
      </span>
    </div>
  );
}
