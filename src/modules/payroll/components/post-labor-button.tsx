'use client';

// Posts a locked pay period's labor into job costs (and can re-post / unpost).
// Wages + employer burden are auto-split across the projects each employee
// logged time to; untagged time is reported, not posted.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import {
  postPayrollLaborAction,
  unpostPayrollLaborAction,
  type PostLaborResult,
} from '@/modules/payroll/actions';

export function PostLaborButton({
  payPeriodId,
  locked,
  accountsConfigured,
  postedCount,
}: {
  payPeriodId: string;
  locked: boolean;
  accountsConfigured: boolean;
  postedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PostLaborResult | null>(null);

  function run(fn: () => Promise<PostLaborResult>) {
    setResult(null);
    startTransition(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  if (!locked) {
    return (
      <p className="text-xs text-slate-500">
        Lock the period to post its labor to job costs.
      </p>
    );
  }
  if (!accountsConfigured) {
    return (
      <p className="text-xs text-amber-700">
        Set the direct-labor and payroll-burden accounts under{' '}
        <span className="font-medium">Settings → Accounting</span> to post labor.
      </p>
    );
  }

  const isPosted = postedCount > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={() => run(() => postPayrollLaborAction(payPeriodId))}
          disabled={pending}
        >
          {pending
            ? 'Posting…'
            : isPosted
              ? 'Re-post labor to job costs'
              : 'Post labor to job costs'}
        </Button>
        {isPosted && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => run(() => unpostPayrollLaborAction(payPeriodId))}
            disabled={pending}
          >
            Unpost
          </Button>
        )}
      </div>

      {isPosted && !result && (
        <p className="text-xs text-emerald-700">
          {postedCount} labor line{postedCount === 1 ? '' : 's'} posted to job
          costs for this period.
        </p>
      )}
      {result?.error && <p className="text-xs text-red-600">{result.error}</p>}
      {result?.ok && result.summary && (
        <p className="text-xs text-emerald-700">
          Posted {formatMoney(result.summary.wage)} wages +{' '}
          {formatMoney(result.summary.burden)} burden across{' '}
          {result.summary.entries} job line
          {result.summary.entries === 1 ? '' : 's'}.
          {result.summary.unposted > 0 && (
            <>
              {' '}
              <span className="text-amber-700">
                {formatMoney(result.summary.unposted)} of pay had no job tag and
                was not posted.
              </span>
            </>
          )}
        </p>
      )}
      {result?.ok && result.reversed !== undefined && (
        <p className="text-xs text-slate-600">
          Unposted {result.reversed} labor line
          {result.reversed === 1 ? '' : 's'}.
        </p>
      )}
    </div>
  );
}
