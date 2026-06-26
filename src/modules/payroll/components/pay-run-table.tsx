'use client';

import { useActionState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
  type EmploymentType,
} from '@/modules/employees/schema';
import { savePayRunAction, type PayOverrideState } from '../actions';

export type PayRunRow = {
  employeeId: string;
  employeeName: string;
  employmentType: EmploymentType;
  hoursWorked: number;
  payRate: number;
  /** Existing override gross, blank string if no override is set. */
  overrideAmount: string;
  /** What the gross would be without an override (rate-based, EXCLUDING piece
   *  work). 0 means no auto-pay (piecework/contract/commission/lump_sum). Used
   *  for the "Auto from rate" column and the override placeholder. */
  rateGross: number;
  /** True gross the paystub pays on — rate/override PLUS piece-work amount
   *  entries. This is the gross net pay is derived from, so it ties out:
   *  net = grossFull + additions − employee NIB − deductions. */
  grossFull: number;
  nibExempt: boolean;
  /** Net pay = gross + reimbursements/per-diem − employee NIB − deductions.
   *  This is what's actually paid out, for tie-out against the bank payment. */
  net: number;
  perDiem: number;
  employeeNib: number;
  /** Employer NIB (6.65%) — the company's own cost, booked as NIB Expense on
   *  the P&L (offsets NIB Payable). On TOP of net pay, never deducted from it. */
  employerNib: number;
  deductions: number;
};

export function PayRunTable({
  rows,
  payPeriodId,
  locked,
}: {
  rows: PayRunRow[];
  payPeriodId: string;
  locked: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    PayOverrideState,
    FormData
  >(savePayRunAction, {});

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-600">No active employees.</p>
      </div>
    );
  }

  // Period totals. Gross is the TRUE gross (rate/override + piece work) the net
  // is derived from, so the footer reconciles exactly:
  //   total net = total gross + additions − employee NIB − deductions.
  // Net sums each saved paystub — the figure that ties to the bank payment.
  // Employer NIB is the company's own cost (booked as NIB Expense on the P&L),
  // surfaced here so it's visible at a glance.
  const totalGross = rows.reduce((s, r) => s + r.grossFull, 0);
  const totalAdditions = rows.reduce((s, r) => s + r.perDiem, 0);
  const totalEmployeeNib = rows.reduce((s, r) => s + r.employeeNib, 0);
  const totalDeductions = rows.reduce((s, r) => s + r.deductions, 0);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const totalEmployerNib = rows.reduce((s, r) => s + r.employerNib, 0);
  const paidRows = rows.filter((r) => r.net > 0).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="payPeriodId" value={payPeriodId} />

      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Hours logged</TableHead>
              <TableHead className="text-right">Auto from rate</TableHead>
              <TableHead className="text-right">Gross this week</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead className="text-right">Net pay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const hasOverride = r.overrideAmount.trim() !== '';
              // Effective gross = the true gross the paystub pays on: the saved
              // override, otherwise rate + piece work. Including piece work here
              // is what makes the row reconcile (net never exceeds gross unless
              // per-diem/bonus additions are layered on, shown in the breakdown).
              const effectiveGross = hasOverride
                ? Number(r.overrideAmount) || 0
                : r.grossFull;
              const pieceWorkOnly = !hasOverride && r.rateGross <= 0 && r.grossFull > 0;
              return (
                <TableRow key={r.employeeId}>
                  <TableCell className="font-medium text-slate-900 whitespace-nowrap">
                    {r.employeeName}
                    {r.nibExempt && (
                      <Badge tone="amber" className="ml-2">
                        NIB exempt
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone={EMPLOYMENT_TYPE_TONE[r.employmentType]}>
                      {EMPLOYMENT_TYPE_LABEL[r.employmentType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {r.employmentType === 'hourly'
                      ? r.hoursWorked.toFixed(2)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-500">
                    {r.rateGross > 0 ? formatMoney(r.rateGross) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      name={`employee:${r.employeeId}`}
                      defaultValue={r.overrideAmount}
                      placeholder={r.rateGross > 0 ? formatMoney(r.rateGross) : '0.00'}
                      disabled={locked}
                      className="text-right tabular-nums max-w-[140px] ml-auto"
                    />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">
                        {formatMoney(effectiveGross)}
                      </span>
                      {hasOverride ? (
                        <Badge tone="blue">Override</Badge>
                      ) : r.rateGross > 0 ? (
                        <Badge tone="slate">From rate</Badge>
                      ) : pieceWorkOnly ? (
                        <Badge tone="slate">Piece work</Badge>
                      ) : (
                        <Badge tone="amber">Needs entry</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="font-semibold text-emerald-700">
                      {formatMoney(r.net)}
                    </div>
                    {(r.perDiem > 0 || r.employeeNib > 0 || r.deductions > 0) && (
                      <div className="text-[10px] text-slate-400">
                        {formatMoney(effectiveGross)}
                        {r.perDiem > 0 && ` + ${formatMoney(r.perDiem)}`}
                        {r.employeeNib > 0 && ` − ${formatMoney(r.employeeNib)} NIB`}
                        {r.deductions > 0 && ` − ${formatMoney(r.deductions)}`}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="border-t-2 border-slate-300 bg-slate-50 hover:bg-slate-50">
              <TableCell
                colSpan={4}
                className="font-semibold text-slate-900"
              >
                Totals · {paidRows} paid
              </TableCell>
              <TableCell className="text-right tabular-nums text-slate-500">
                {/* Gross input column — leave blank */}
              </TableCell>
              <TableCell className="tabular-nums font-semibold text-slate-900">
                {formatMoney(totalGross)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <div className="text-base font-bold text-emerald-700">
                  {formatMoney(totalNet)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Total net · pays out
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="font-medium text-slate-700">
            Total net pay this period
          </span>
          <span className="text-lg font-bold text-emerald-700 tabular-nums">
            {formatMoney(totalNet)}
          </span>
        </div>
        {/* Reconciliation: gross (incl. piece work) + additions − NIB −
            deductions = net. Shown so the total ties out term by term. */}
        <p className="mt-1 text-xs text-slate-500 tabular-nums">
          {formatMoney(totalGross)} gross
          {totalAdditions > 0 && (
            <> + {formatMoney(totalAdditions)} per-diem/bonus</>
          )}
          {totalEmployeeNib > 0 && (
            <> − {formatMoney(totalEmployeeNib)} employee NIB</>
          )}
          {totalDeductions > 0 && (
            <> − {formatMoney(totalDeductions)} deductions</>
          )}{' '}
          = <span className="font-medium text-emerald-700">{formatMoney(totalNet)} net</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Net is what leaves the bank — match it to the payroll bank payment.
          Gross includes piece-work pay. Employer NIB of{' '}
          <span className="font-medium text-slate-700 tabular-nums">
            {formatMoney(totalEmployerNib)}
          </span>{' '}
          is the company&apos;s own cost on top of net pay (not deducted from
          it); generating payroll bills books it as{' '}
          <span className="font-medium text-slate-700">NIB Expense</span> on the
          P&amp;L, offsetting the NIB Payable owed to the government.
        </p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-slate-500">
          Blank rows clear any existing override and revert to the auto-from-rate
          number (or $0 for piecework / contract / commission / lump-sum types).
        </p>
        <Button type="submit" disabled={pending || locked}>
          {pending ? 'Saving…' : 'Save pay run'}
        </Button>
      </div>
    </form>
  );
}
