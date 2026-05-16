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
  unpostReceiptAction,
  voidReceiptAction,
} from '../actions';

export type PostPanelProps = {
  receiptId: string;
  status: 'draft' | 'submitted' | 'posted' | 'void';
  canPostable: boolean; // ≥1 line, every line has project + cost code, not voided
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
      const res = await postReceiptAction({ id: props.receiptId });
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

  function onUnpost() {
    if (
      !confirm(
        'Unpost this receipt? All linked job-cost entries will be removed.',
      )
    )
      return;
    startTransition(async () => {
      const res = await unpostReceiptAction({ id: props.receiptId });
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
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
        <div className="text-xs text-emerald-900 font-medium">
          Posted to job costs.
        </div>
        <p className="text-[11px] text-emerald-800">
          Approved
          {props.approvedAt ? ` on ${props.approvedAt}` : ''}
          {props.approvedByName ? ` by ${props.approvedByName}` : ''}.
          One job_cost_entries row per line.
        </p>
        {props.canApprove && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onUnpost}
          >
            {pending ? '…' : 'Unpost'}
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
              disabled={pending || !props.canPostable}
              onClick={onApproveAndPost}
              title={
                !props.canPostable
                  ? 'Every line needs a project and cost code before posting.'
                  : undefined
              }
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
            disabled={pending || !props.canPostable}
            onClick={onApproveAndPost}
            title={
              !props.canPostable
                ? 'Every line needs a project and cost code before posting.'
                : undefined
            }
          >
            {pending ? 'Posting…' : 'Approve & post'}
          </Button>
        )}
        {props.canSubmit && (
          <Button
            type="button"
            variant={props.canApprove ? 'outline' : 'default'}
            size={props.canApprove ? 'sm' : undefined}
            disabled={pending || !props.canPostable}
            onClick={onSubmitForReview}
            title={
              !props.canPostable
                ? 'Every line needs a project and cost code before submitting.'
                : undefined
            }
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
      {!props.canPostable && (
        <p className="text-[11px] text-slate-500">
          Every line needs a project and cost code before
          {props.canApprove ? ' posting or submitting' : ' submitting'}.
        </p>
      )}
    </div>
  );
}
