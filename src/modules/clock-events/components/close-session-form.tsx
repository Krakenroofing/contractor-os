'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { closeSessionAction, type CloseSessionState } from '../actions';

/**
 * Records the missing clock-out for an open session. `inId` is the
 * dangling IN punch; the action validates the OUT is after the IN and
 * that the session is still open. `inLabel` is the clock-in time, shown
 * for reference so the office can pick a sensible end.
 */
export function CloseSessionForm({
  inId,
  defaultOccurredAt,
  inLabel,
  projectLabel,
}: {
  inId: string;
  defaultOccurredAt: string; // 'YYYY-MM-DDTHH:mm' in APP_TZ
  inLabel: string;
  projectLabel: string | null;
}) {
  const boundAction = closeSessionAction.bind(null, inId);
  const [state, formAction, pending] = useActionState<
    CloseSessionState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-slate-600">
        Clocked in at <strong className="text-slate-900">{inLabel}</strong>.
        Set the time this worker actually stopped — the session will pair up
        and become reviewable.
      </p>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Clock-out time (Nassau)
        </label>
        <input
          type="datetime-local"
          name="occurredAt"
          defaultValue={defaultOccurredAt}
          required
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          name="notes"
          rows={2}
          placeholder="e.g. forgot to punch out — confirmed end time with foreman"
          className="w-full max-w-2xl rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <p className="text-xs text-slate-500">
        The clock-out inherits this session&apos;s project
        {projectLabel ? ` (${projectLabel})` : ' (overhead / no project)'} and
        cost code. You can adjust either punch afterward from the day grid.
      </p>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record clock-out'}
        </Button>
      </div>
    </form>
  );
}
