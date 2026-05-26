'use client';

// Self-link picker — shows on /field/profile when the signed-in user is
// owner/PM AND has no employee_id yet. Lets them claim themselves so
// the rest of the field app starts working.

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  linkSelfToEmployeeAction,
  unlinkSelfFromEmployeeAction,
  type LinkEmployeeState,
} from '../link-employee-actions';

const initial: LinkEmployeeState = {};

type EmployeeOpt = { id: string; label: string; alreadyLinked: boolean };

export function SelfLinkPanel({ employees }: { employees: EmployeeOpt[] }) {
  const [state, formAction, pending] = useActionState(
    linkSelfToEmployeeAction,
    initial,
  );
  const linkable = employees.filter((e) => !e.alreadyLinked);

  return (
    <form
      action={formAction}
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-3"
    >
      <p className="text-sm font-medium text-amber-900">
        Tell us which employee record is you
      </p>
      <p className="text-xs text-amber-800">
        Field-app features (clock in/out, daily reports) need to know
        which employee you are. Pick yourself from the list below and tap
        Link. You can change this later.
      </p>

      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="employeeId" className="text-xs">
          I am
        </Label>
        {linkable.length === 0 ? (
          <p className="text-xs text-amber-900">
            No unlinked employees available. Go to{' '}
            <span className="font-medium">/employees</span> on the desktop
            site and add your record first.
          </p>
        ) : (
          <Select name="employeeId" id="employeeId" required defaultValue="">
            <option value="" disabled>
              Pick yourself…
            </option>
            {linkable.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        )}
      </div>

      <Button
        type="submit"
        disabled={pending || linkable.length === 0}
        className="w-full"
      >
        {pending ? 'Linking…' : 'Link my employee record'}
      </Button>
    </form>
  );
}

export function UnlinkButton() {
  const [state, formAction, pending] = useActionState(
    unlinkSelfFromEmployeeAction,
    initial,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Unlink your employee record? Your existing clock-ins and daily reports stay attributed to that employee, but new ones can\'t be created until you re-link.',
          )
        )
          e.preventDefault();
      }}
    >
      {state.formError && (
        <p className="text-xs text-red-600 mb-1">{state.formError}</p>
      )}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="w-full text-xs"
        disabled={pending}
      >
        {pending ? 'Unlinking…' : 'Unlink employee record'}
      </Button>
    </form>
  );
}
