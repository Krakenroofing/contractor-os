'use client';

// PO approval (roadmap P6): over the company limit, a PO needs an approver
// other than its creator before it goes out. Owners approving their own
// PO give a reason, which is logged for the other owner to review.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { approvePurchaseOrderAction } from '../actions';

export function PoApprovalPanel(props: {
  poId: string;
  status: string;
  total: number;
  limit: number;
  approved: { byName: string | null; at: string; total: number } | null;
  creatorName: string | null;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const approvalCurrent = props.approved && props.approved.total >= props.total;

  function approve(issue: boolean, reason?: string) {
    setError(null);
    start(async () => {
      const res = await approvePurchaseOrderAction({ id: props.poId, issue, reason });
      if (!res.ok && res.needsReason) {
        const r = window.prompt(`${res.error}\n\nReason:`);
        if (r && r.trim()) approve(issue, r.trim());
        return;
      }
      if (!res.ok) {
        setError(res.error ?? 'Could not approve.');
        return;
      }
      router.refresh();
    });
  }

  if (approvalCurrent) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
        ✓ Approved for {money(props.approved!.total)}
        {props.approved!.byName ? ` by ${props.approved!.byName}` : ''} on{' '}
        {props.approved!.at}.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div>
        <div className="font-medium">
          Needs approval — {money(props.total)} is over the {money(props.limit)}{' '}
          limit
        </div>
        <div className="text-xs">
          {props.approved
            ? `Approved earlier for ${money(props.approved.total)}; the total has gone up since. `
            : ''}
          {props.creatorName ? `Raised by ${props.creatorName}. ` : ''}
          An approver other than whoever raised it signs off before it goes
          to the vendor.
        </div>
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </div>
      {props.canApprove && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => approve(false)}
          >
            Approve
          </Button>
          {props.status === 'draft' && (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => approve(true)}
            >
              {pending ? 'Working…' : 'Approve & issue'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
