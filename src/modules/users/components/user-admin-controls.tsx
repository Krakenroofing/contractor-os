'use client';

// Owner controls for one member row on /invite: change role (auto-submits on
// pick) and suspend / restore access. Guards live server-side; here we just
// disable the obvious foot-guns (suspending yourself) and surface errors.

import { useActionState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/permissions';
import {
  changeUserRoleAction,
  restoreUserAction,
  suspendUserAction,
  type UserAdminState,
} from '../actions';

const empty: UserAdminState = {};

export function UserAdminControls({
  userId,
  currentRole,
  status,
  isSelf,
}: {
  userId: string;
  currentRole: Role;
  status: 'active' | 'invited' | 'suspended';
  isSelf: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState(
    changeUserRoleAction,
    empty,
  );
  const suspended = status === 'suspended';
  const [accessState, accessAction, accessPending] = useActionState(
    suspended ? restoreUserAction : suspendUserAction,
    empty,
  );

  const error = roleState.error || accessState.error;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <form action={roleAction}>
          <input type="hidden" name="userId" value={userId} />
          {/* Native select so onChange can auto-submit its parent form. */}
          <select
            name="role"
            defaultValue={currentRole}
            disabled={rolePending || suspended}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs disabled:opacity-50"
            aria-label="Role"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </form>

        <form action={accessAction}>
          <input type="hidden" name="userId" value={userId} />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={accessPending || (isSelf && !suspended)}
            className={suspended ? '' : 'text-red-600 hover:text-red-700'}
          >
            {suspended ? 'Restore access' : 'Suspend'}
          </Button>
        </form>

        {suspended && <Badge tone="red">suspended</Badge>}
        {isSelf && <span className="text-[10px] text-slate-400">(you)</span>}
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
