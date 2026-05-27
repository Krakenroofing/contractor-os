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
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
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
      {state.ok && (
        <span className="text-xs text-emerald-700">Saved</span>
      )}
      {state.error && (
        <span className="text-xs text-red-600">{state.error}</span>
      )}
    </form>
  );
}
