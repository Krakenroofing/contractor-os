'use client';

// Detail-page action bar: Edit / Record Payment / Delete (drafts only) —
// all clearly visible, none hidden behind menus. The Void transition lives
// in <StatusPanel> alongside the other status moves so it stays in one
// place; this bar just exposes the high-frequency actions.

import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  deleteDraftInvoiceAction,
  voidAndReissueInvoiceAction,
} from '@/modules/invoices/actions';

const initialDeleteState: { ok?: boolean; formError?: string } = {};

export function InvoiceActionsBar({
  id,
  status,
  hasPayments,
  allowEdit,
}: {
  id: string;
  status: string;
  hasPayments: boolean;
  allowEdit: boolean;
}) {
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteDraftInvoiceAction,
    initialDeleteState,
  );

  const router = useRouter();
  const [reissuing, startReissue] = useTransition();
  const [reissueError, setReissueError] = useState<string | null>(null);

  const isVoid = status === 'void';
  const isIssued = !isVoid && status !== 'draft';
  const canHardDelete = allowEdit && status === 'draft' && !hasPayments;
  const canEdit = allowEdit && !isVoid;
  const canRecordPayment = allowEdit && !isVoid && status !== 'paid';
  const canReissue = allowEdit && isIssued && !hasPayments;

  function reissue() {
    if (
      !confirm(
        'Void this invoice and reissue it?\n\nThis invoice stays on record as VOID under its number. A new draft copy opens with the next invoice number for you to correct and send.',
      )
    )
      return;
    startReissue(async () => {
      setReissueError(null);
      const res = await voidAndReissueInvoiceAction(id);
      if (!res.ok || !res.newId) {
        setReissueError(res.error ?? 'Could not reissue.');
        return;
      }
      router.push(`/invoices/${res.newId}/edit`);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Link href={`/invoices/${id}/edit`}>
            <Button size="sm" variant="outline">
              {isIssued ? 'Edit notes & terms' : 'Edit'}
            </Button>
          </Link>
        )}
        {canReissue && (
          <Button
            size="sm"
            variant="outline"
            onClick={reissue}
            disabled={reissuing}
            title="Issued invoices are final — void this one (it keeps its number) and open a corrected draft copy"
          >
            {reissuing ? 'Reissuing…' : 'Void & reissue'}
          </Button>
        )}
        {canRecordPayment && (
          <Link href={`/payments/new?invoiceId=${id}`}>
            <Button size="sm">Record payment</Button>
          </Link>
        )}
        {canHardDelete && (
          <form action={deleteAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmButton
              size="sm"
              confirmLabel="Click again to delete"
              pendingLabel="Deleting…"
            >
              Delete draft
            </ConfirmButton>
          </form>
        )}
      </div>
      {deleteState.formError && (
        <p className="text-xs text-red-600">{deleteState.formError}</p>
      )}
      {reissueError && <p className="text-xs text-red-600">{reissueError}</p>}
      {isIssued && hasPayments && allowEdit && (
        <p className="text-xs text-slate-500">
          This invoice is issued and has payments — its amounts are final. To
          correct the money, use <strong>Issue credit memo</strong>.
        </p>
      )}
      {!canHardDelete && allowEdit && status === 'draft' && hasPayments && (
        <p className="text-xs text-slate-500">
          Hard delete is disabled because this draft has payments. Use{' '}
          <strong>Void</strong> in the status panel to soft-delete instead —
          history is preserved.
        </p>
      )}
      {!isVoid && status !== 'draft' && allowEdit && (
        <p className="text-xs text-slate-500">
          To remove this invoice from dashboard / AR totals, use the{' '}
          <strong>Void invoice</strong> action in the status panel above.
          Voiding preserves payment history and the audit trail.
        </p>
      )}
      {/* Suppress the unused-pending lint without altering button state — the
          ConfirmButton manages its own pending UI via useFormStatus. */}
      <span hidden aria-hidden="true">
        {deletePending ? '' : ''}
      </span>
    </div>
  );
}
