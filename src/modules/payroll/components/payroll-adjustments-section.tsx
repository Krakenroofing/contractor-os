// Per-employee pay adjustments (per diem / reimbursement / bonus / deduction)
// for the week — surfaced on both the Timesheet and Pay Run tabs. Each employee
// is a collapsible row wrapping the same editor used on the Paystubs tab, so
// edits stay in one place.

import { PaystubAdjustmentsEditor } from './paystub-adjustments-editor';
import type { PaystubLineItem } from '../lib/payroll-math';

export type AdjustmentEmployeeRow = {
  employeeId: string;
  name: string;
  deductions: PaystubLineItem[];
  additions: PaystubLineItem[];
};

export function PayrollAdjustmentsSection({
  rows,
  payPeriodId,
  locked,
}: {
  rows: AdjustmentEmployeeRow[];
  payPeriodId: string;
  locked: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-medium text-slate-700">Pay adjustments</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Per diem, reimbursement, bonus, or a deduction (e.g. payroll back
          charge) — per employee, this week. Additions are NIB-free; deductions
          come off before NIB.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((r) => {
          const count = r.deductions.length + r.additions.length;
          return (
            <details key={r.employeeId} className="px-4 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
                <span className="font-medium text-slate-900">{r.name}</span>
                <span className="text-xs text-slate-500">
                  {count > 0
                    ? `${count} adjustment${count === 1 ? '' : 's'}`
                    : 'none'}{' '}
                  · <span className="text-blue-600">add ▸</span>
                </span>
              </summary>
              <div className="pt-2 pb-1">
                <PaystubAdjustmentsEditor
                  employeeId={r.employeeId}
                  payPeriodId={payPeriodId}
                  deductions={r.deductions}
                  additions={r.additions}
                  locked={locked}
                />
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
