'use client';

// Generates QuickBooks-style payroll bills for a locked pay period (one per
// paid employee). Re-generating replaces the period's bills + journal entries.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import {
  generatePayrollBillsAction,
  type GeneratePayrollBillsResult,
} from '@/modules/payroll/actions';

export function GeneratePayrollBillsButton({
  payPeriodId,
  locked,
  billCount,
}: {
  payPeriodId: string;
  locked: boolean;
  billCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<GeneratePayrollBillsResult | null>(null);

  if (!locked) {
    return (
      <p className="text-xs text-slate-500">
        Lock the period to generate payroll bills.
      </p>
    );
  }

  function run() {
    setResult(null);
    start(async () => {
      const res = await generatePayrollBillsAction(payPeriodId);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={run} disabled={pending}>
        {pending
          ? 'Generating…'
          : billCount > 0
            ? 'Re-generate payroll bills'
            : 'Generate payroll bills'}
      </Button>
      {billCount > 0 && !result && (
        <p className="text-xs text-emerald-700">
          {billCount} payroll bill{billCount === 1 ? '' : 's'} generated for this
          period.
        </p>
      )}
      {result?.error && <p className="text-xs text-red-600">{result.error}</p>}
      {result?.ok && (
        <p className="text-xs text-emerald-700">
          {result.count} payroll bill{result.count === 1 ? '' : 's'} in sync —{' '}
          {formatMoney(result.total ?? 0)} net payable
          {(result.updated ?? 0) > 0 && <> · {result.updated} updated</>}
          {(result.deleted ?? 0) > 0 && <> · {result.deleted} removed</>}.
        </p>
      )}
      {result?.ok && (result.warnings?.length ?? 0) > 0 && (
        <p className="text-xs text-amber-700">
          Not updated (a bank payment is matched):{' '}
          {result.warnings!.join(' ')}
        </p>
      )}
    </div>
  );
}
