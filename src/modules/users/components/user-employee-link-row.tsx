'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  linkUserToEmployeeAction,
  type LinkUserState,
} from '../actions';

export type EmployeeOption = {
  id: string;
  label: string;
  /** Email of the user already linked, or null if free. */
  linkedToEmail: string | null;
};

export function UserEmployeeLinkRow({
  userId,
  userEmail,
  currentEmployeeId,
  options,
}: {
  userId: string;
  userEmail: string;
  currentEmployeeId: string | null;
  options: EmployeeOption[];
}) {
  const bound = linkUserToEmployeeAction.bind(null, userId);
  const [state, formAction, pending] = useActionState<LinkUserState, FormData>(
    bound,
    {},
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Both forms post to the same bound action; the picker submits the
          chosen employeeId, the Unlink form submits an empty one. They're
          separate forms so the select's value can't shadow the empty one
          (FormData.get returns the first field of a given name). */}
      <form action={formAction} className="flex items-center gap-2">
        <select
          name="employeeId"
          defaultValue={currentEmployeeId ?? ''}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm bg-white max-w-xs"
        >
          <option value="">— Not linked —</option>
          {options.map((o) => {
            // Annotate already-linked options so the admin sees the conflict
            // BEFORE submitting. Submitting one of these still works if the
            // admin first unlinks the other user (we don't disable, just warn).
            const taken =
              o.linkedToEmail !== null && o.linkedToEmail !== userEmail;
            return (
              <option key={o.id} value={o.id}>
                {o.label}
                {taken ? ` (linked to ${o.linkedToEmail})` : ''}
              </option>
            );
          })}
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </form>

      {/* One-click unlink when currently linked — no hunting for "Not
          linked" in the dropdown. */}
      {currentEmployeeId && (
        <form action={formAction}>
          <input type="hidden" name="employeeId" value="" />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            disabled={pending}
            className="text-red-600 hover:text-red-700"
          >
            Unlink
          </Button>
        </form>
      )}

      {state.ok && <span className="text-xs text-emerald-700">Saved</span>}
      {state.error && (
        <span className="text-xs text-red-600">{state.error}</span>
      )}
    </div>
  );
}
