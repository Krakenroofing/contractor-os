'use client';

// Small client component that triggers reconcileInvoicesAction and renders
// the resulting summary inline. Lives on the invoice list so users without
// DB access can run the legacy backfill themselves.

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  reconcileInvoicesAction,
  type ReconcileBackfillState,
} from '@/modules/invoices/actions';

const initial: ReconcileBackfillState = {};

export function ReconcileButton() {
  const [state, formAction, pending] = useActionState(
    reconcileInvoicesAction,
    initial,
  );
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Reconciling…' : 'Reconcile invoices'}
      </Button>
      {state.report && (
        <span className="text-xs text-slate-600">
          Scanned {state.report.invoicesScanned} ·{' '}
          {state.report.backfillPaymentsInserted} backfilled ·{' '}
          {state.report.invoicesUpdated} updated
        </span>
      )}
      {state.formError && (
        <span className="text-xs text-red-600">{state.formError}</span>
      )}
    </form>
  );
}
