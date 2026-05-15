'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  postReceiptAction,
  unpostReceiptAction,
  voidReceiptAction,
  deleteReceiptAction,
} from '../actions';

export type PostPanelProps = {
  receiptId: string;
  status: 'draft' | 'posted' | 'void';
  canPostable: boolean; // project + cost code present, not voided
  hasPotentialDuplicate: boolean; // matching (project, vendor, amount, date) found
  potentialDuplicateMessage?: string;
  canPost: boolean;
};

export function ReceiptPostPanel(props: PostPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onPost() {
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

  function onUnpost() {
    if (!confirm('Unpost this receipt? The linked job-cost entry will be removed.'))
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

  if (props.status === 'void') {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        This receipt is void. Delete to remove from the list, or recover via DB.
        <div className="mt-2">
          {props.canPost && (
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

  if (props.status === 'posted') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-2">
        <div className="text-xs text-emerald-900 font-medium">
          Posted to job costs.
        </div>
        <p className="text-xs text-emerald-800">
          A job_cost_entries row was created with source=receipt_import. Unpost
          to edit any field.
        </p>
        {props.canPost && (
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

  // Draft
  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-2">
      {props.hasPotentialDuplicate && (
        <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          <div className="font-medium">Possible duplicate</div>
          <div>{props.potentialDuplicateMessage}</div>
        </div>
      )}
      <div className="flex items-center gap-2">
        {props.canPost && (
          <Button
            type="button"
            disabled={pending || !props.canPostable}
            onClick={onPost}
            title={
              !props.canPostable
                ? 'Project and cost code are required to post.'
                : undefined
            }
          >
            {pending ? 'Posting…' : 'Post to job costs'}
          </Button>
        )}
        {props.canPost && (
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
          Project and cost code are required before posting.
        </p>
      )}
    </div>
  );
}
