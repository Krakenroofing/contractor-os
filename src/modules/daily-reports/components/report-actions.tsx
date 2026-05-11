'use client';

import { useActionState } from 'react';
import { ConfirmButton } from '@/components/ui/confirm-button';
import {
  voidDailyReportAction,
  deleteDailyReportAction,
  type SimpleState,
} from '../actions';

export function VoidReportForm({
  projectId,
  reportId,
}: {
  projectId: string;
  reportId: string;
}) {
  const bound = voidDailyReportAction.bind(null, projectId, reportId);
  const [state, formAction] = useActionState<SimpleState, FormData>(bound, {});
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <ConfirmButton
        variant="outline"
        size="sm"
        confirmLabel="Click again to void"
        pendingLabel="Voiding…"
      >
        Void
      </ConfirmButton>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}

export function DeleteReportForm({
  projectId,
  reportId,
}: {
  projectId: string;
  reportId: string;
}) {
  const bound = deleteDailyReportAction.bind(null, projectId, reportId);
  const [state, formAction] = useActionState<SimpleState, FormData>(bound, {});
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <ConfirmButton
        variant="destructive"
        size="sm"
        confirmLabel="Click again to delete"
        pendingLabel="Deleting…"
      >
        Delete
      </ConfirmButton>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
