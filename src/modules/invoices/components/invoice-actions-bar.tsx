'use client';

// Detail-page action bar: Edit / Record Payment / Delete (drafts only) —
// all clearly visible, none hidden behind menus. The Void transition lives
// in <StatusPanel> alongside the other status moves so it stays in one
// place; this bar just exposes the high-frequency actions.

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  deleteDraftInvoiceAction,
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

  const isVoid = status === 'void';
  const canHardDelete = allowEdit && status === 'draft' && !hasPayments;
  const canEdit = allowEdit && !isVoid;
  const canRecordPayment = allowEdit && !isVoid && status !== 'paid';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Link href={`/invoices/${id}/edit`}>
            <Button size="sm" variant="outline">
              Edit
            </Button>
          </Link>
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
