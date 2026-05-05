'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  revokeInvitationAction,
  type RevokeInvitationState,
} from '@/modules/invitations/actions';

const initial: RevokeInvitationState = {};

export function RevokeButton({ invitationId }: { invitationId: string }) {
  const [state, formAction, pending] = useActionState(
    revokeInvitationAction,
    initial,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Revoking…' : 'Revoke'}
      </Button>
      {state.formError && (
        <span className="text-xs text-red-600 ml-2">{state.formError}</span>
      )}
    </form>
  );
}
