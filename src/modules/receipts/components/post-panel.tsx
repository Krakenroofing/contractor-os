'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deleteReceiptAction,
  postReceiptAction,
  rejectReceiptAction,
  submitReceiptAction,
  voidAndCorrectReceiptAction,
  voidReceiptAction,
} from '../actions';

export type PostPanelProps = {
  receiptId: string;
  status: 'draft' | 'submitted' | 'posted' | 'void';
  /** A void bill that had been posted — kept on record, never deletable. */
  wasPosted?: boolean;
  /** Precise reasons the receipt can't post yet (per line), empty when
   *  postable. Rendered as a checklist so the greyed-out button explains
   *  itself instead of leaving the operator to guess. */
  postBlockers: string[];
  hasPotentialDuplicate: boolean;
  potentialDuplicateMessage?: string;
  /** Approve & post, reject, unpost, void, delete. Owners + accounting. */
  canApprove: boolean;
  /** Anyone with create perm can submit a draft for review. */
  canSubmit: boolean;
  submittedAt?: string;
  submittedByName?: string;
  approvedAt?: string;
  approvedByName?: string;
  rejectionReason?: string;
};

export function ReceiptPostPanel(props: PostPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const canPostable = props.postBlockers.length === 0;
  const blockerTitle = canPostable ? undefined : props.postBlockers.join('\n');

  function onSubmitForReview() {
    startTransition(async () => {
      const res = await submitReceiptAction({ id: props.receiptId });
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
    });
  }

  function onApproveAndPost() {
    if (
      props.hasPotentialDuplicate &&
      !confirm(
        (props.potentialDuplicateMessage ?? 'A similar job-cost entry exists.') +
          '\n\nPost anyway?',
      )
    )
      return;
    startTransition(async () => {
      let res = await postReceiptAction({ id: props.receiptId });
      // Over the approval limit and you entered it: an owner may approve
      // their own bill with a reason (logged for the other owner).
      if (!res.ok && res.needsReason) {
        const reason = window.prompt(`${res.error}\n\nReason:`);
        if (!reason || !reason.trim()) return;
        res = await postReceiptAction({
          id: props.receiptId,
          selfApprovalReason: reason.trim(),
        });
      }
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
    });
  }

  function onConfirmReject() {
    startTransition(async () => {
      const res = await rejectReceiptAction({
        id: props.receiptId,
        reason: rejectReason,
      });
      if (!res.ok && res.error) alert(res.error);
      setRejectOpen(false);
      setRejectReason('');
      router.refresh();
    });
  }

  function onVoidAndCorrect() {
    if (
      !confirm(
        'Void this bill and open a corrected copy?\n\nThe original stays on record as void (its job cost and GL entry are cleared). An editable draft copy opens with the same lines and attachments; any bank payments or vendor credits move to the copy and settle it once you post it.',
      )
    )
      return;
    startTransition(async () => {
      const res = await voidAndCorrectReceiptAction({ id: props.receiptId });
      if (!res.ok) {
        alert(res.error ?? 'Could not void and correct this bill.');
        router.refresh();
        return;
      }
      router.push(`/banking/receipts/${res.newId}` as never);
    });
  }

  function onVoid() {
    if (!confirm('Mark this receipt void? Cannot undo from the UI.')) return;
    startTransition(async () => {
      const res = await voidReceiptAction({ id: props.receiptId });
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm('Delete this receipt? Soft-deletes (recoverable in DB).'))
      return;
    startTransition(async () => {
      const res = await deleteReceiptAction({ id: props.receiptId });
      if (!res.ok && res.error) alert(res.error);
      else router.push('/banking/receipts' as never);
    });
  }

  // ===== Void =====
  if (props.status === 'void') {
    if (props.wasPosted) {
      return (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          This bill was posted, then voided. It stays on record for the audit
          trail and no longer counts toward job cost, AP or the P&amp;L.
        </div>
      );
    }
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        This receipt is void. Delete to remove from the list, or recover via DB.
        <div className="mt-2">
          {props.canApprove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ===== Posted =====
  if (props.status === 'posted') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-2">
        <div className="text-xs text-emerald-900 font-medium">Posted.</div>
        <p className="text-[11px] text-emerald-800">
          Approved
          {props.approvedAt ? ` on ${props.approvedAt}` : ''}
          {props.approvedByName ? ` by ${props.approvedByName}` : ''}.
          Job-cost lines post to job costing; overhead lines (category only)
          post to the P&amp;L. Posted bills are final — to change one, void
          it and post the corrected copy.
        </p>
        {props.canApprove && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onVoidAndCorrect}
          >
            {pending ? 'Working…' : 'Void & correct'}
          </Button>
        )}
      </div>
    );
  }

  // ===== Submitted =====
  if (props.status === 'submitted') {
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
        <div className="text-xs text-blue-900 font-medium">
          Submitted for review
        </div>
        <p className="text-[11px] text-blue-800">
          Submitted
          {props.submittedAt ? ` on ${props.submittedAt}` : ''}
          {props.submittedByName ? ` by ${props.submittedByName}` : ''}.
          {props.canApprove
            ? ' Approve & post, or reject to send back to draft.'
            : ' Waiting for an approver (owner / accounting).'}
        </p>
        {props.canApprove && !rejectOpen && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={pending || !canPostable}
              onClick={onApproveAndPost}
              title={blockerTitle}
            >
              {pending ? 'Posting…' : 'Approve & post'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
          </div>
        )}
        {props.canApprove && <BlockerList blockers={props.postBlockers} />}
        {props.canApprove && rejectOpen && (
          <div className="space-y-2 pt-1">
            <Input
              placeholder="Reason (shown to submitter)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={500}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={onConfirmReject}
              >
                {pending ? '…' : 'Confirm reject'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setRejectOpen(false);
                  setRejectReason('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== Draft =====
  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-2">
      {props.rejectionReason && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-900">
          <div className="font-medium">Rejected — needs changes</div>
          <div>{props.rejectionReason}</div>
        </div>
      )}
      {props.hasPotentialDuplicate && (
        <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          <div className="font-medium">Possible duplicate</div>
          <div>{props.potentialDuplicateMessage}</div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {props.canApprove && (
          <Button
            type="button"
            disabled={pending || !canPostable}
            onClick={onApproveAndPost}
            title={blockerTitle}
          >
            {pending ? 'Posting…' : 'Approve & post'}
          </Button>
        )}
        {props.canSubmit && (
          <Button
            type="button"
            variant={props.canApprove ? 'outline' : 'default'}
            size={props.canApprove ? 'sm' : undefined}
            disabled={pending || !canPostable}
            onClick={onSubmitForReview}
            title={blockerTitle}
          >
            {pending ? 'Submitting…' : 'Submit for review'}
          </Button>
        )}
        {props.canApprove && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onVoid}
            >
              Void
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={onDelete}
            >
              Delete
            </Button>
          </>
        )}
      </div>
      <BlockerList blockers={props.postBlockers} />
    </div>
  );
}

/** Amber checklist of exactly why the receipt can't post/submit yet —
 *  one row per problem line, so the greyed-out button never leaves the
 *  operator guessing. Renders nothing when the receipt is postable. */
function BlockerList({ blockers }: { blockers: string[] }) {
  if (blockers.length === 0) return null;
  return (
    <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2">
      <div className="text-xs font-medium text-amber-900">
        Can&apos;t post yet — fix the following:
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800 list-disc pl-4">
        {blockers.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}
