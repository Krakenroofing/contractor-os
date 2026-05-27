'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { editPunchAction, type EditPunchState } from '../actions';

type Option = { id: string; label: string };

export function EditPunchForm({
  punchId,
  defaults,
  projects,
  costCodes,
}: {
  punchId: string;
  defaults: {
    occurredAt: string; // 'YYYY-MM-DDTHH:mm' in APP_TZ
    projectId: string;
    costCodeId: string;
    notes: string;
  };
  projects: Option[];
  costCodes: Option[];
}) {
  const boundAction = editPunchAction.bind(null, punchId);
  const [state, formAction, pending] = useActionState<EditPunchState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Time (Nassau)
        </label>
        <input
          type="datetime-local"
          name="occurredAt"
          defaultValue={defaults.occurredAt}
          required
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {state.errors?.occurredAt && (
          <p className="mt-1 text-xs text-red-600">
            {state.errors.occurredAt.join(' ')}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Project
        </label>
        <select
          name="projectId"
          defaultValue={defaults.projectId}
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">— No project (overhead / yard) —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Cost code
        </label>
        <select
          name="costCodeId"
          defaultValue={defaults.costCodeId}
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">— No cost code —</option>
          {costCodes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Notes
        </label>
        <textarea
          name="notes"
          defaultValue={defaults.notes}
          rows={3}
          className="w-full max-w-2xl rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {state.formError && (
        <p className="text-sm text-red-600">{state.formError}</p>
      )}

      <p className="text-xs text-slate-500">
        Saving clears the review flag — the session has to be re-reviewed
        before it posts to payroll.
      </p>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save punch'}
        </Button>
      </div>
    </form>
  );
}
