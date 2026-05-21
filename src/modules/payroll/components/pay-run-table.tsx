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
  /** What the gross would be without an override (rate-based). 0 means no
   *  auto-pay (piecework/contract/commission/lump_sum without override). */
  rateGross: number;
  nibExempt: boolean;
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const hasOverride = r.overrideAmount.trim() !== '';
              const effectiveGross = hasOverride
                ? Number(r.overrideAmount) || 0
                : r.rateGross;
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
                      ) : (
                        <Badge tone="amber">Needs entry</Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
