'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { rebuildGlAction } from '../gl-actions';

export function RebuildGlButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`text-xs ${isError ? 'text-red-600' : 'text-slate-600'}`}>
          {msg}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            setIsError(false);
            const res = await rebuildGlAction();
            if (!res.ok) {
              setIsError(true);
              setMsg(res.error ?? 'Rebuild failed.');
              return;
            }
            const failed = res.failures?.length
              ? ` · ${res.failures.length} skipped`
              : '';
            setMsg(
              `Posted ${res.postedInvoices} invoices, ${res.postedPayments} payments, ${res.postedBankTxns} bank txns, ${res.postedOpenings} openings${failed}.`,
            );
            router.refresh();
          })
        }
      >
        {pending ? 'Rebuilding…' : 'Rebuild from invoices & payments'}
      </Button>
    </div>
  );
}
