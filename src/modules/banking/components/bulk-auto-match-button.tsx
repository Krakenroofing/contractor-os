'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { bulkAutoMatchExactAction } from '../actions';

export function BulkAutoMatchButton({
  bankAccountId,
  exactCount,
}: {
  bankAccountId: string;
  exactCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ matched: number; scanned: number } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);

  if (exactCount === 0) return null;

  function go() {
    setErr(null);
    setConfirming(false);
    startTransition(async () => {
      const res = await bulkAutoMatchExactAction({ bankAccountId });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setResult({ matched: res.matched, scanned: res.scanned });
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        {pending ? 'Matching…' : `Auto-match exact pairs (${exactCount})`}
      </Button>
      {result && (
        <span className="text-xs text-emerald-700 ml-2">
          Matched {result.matched} of {result.scanned}.
        </span>
      )}
      {err && <span className="text-xs text-red-600 ml-2">{err}</span>}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-md shadow-xl max-w-md w-full p-5 space-y-3">
            <h3 className="text-base font-semibold">Auto-match exact pairs</h3>
            <p className="text-sm text-slate-700">
              This will match every unreconciled, non-ignored transaction in
              this account that has an EXACT same-amount, same-date pair (an
              invoice payment or posted receipt) that&apos;s not already
              matched. Nothing is posted. Each match is reversible.
            </p>
            <p className="text-xs text-slate-500">
              Approximate hits: <span className="font-medium">{exactCount}</span>
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={go} disabled={pending}>
                {pending ? 'Matching…' : 'Match all'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
