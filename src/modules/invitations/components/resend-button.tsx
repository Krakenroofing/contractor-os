'use client';

// Re-arms a pending/expired invite with a fresh token + expiry and reveals a
// new accept link to copy. Owner-only (server-enforced).

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  resendInvitationAction,
  type ResendInvitationState,
} from '../actions';

const empty: ResendInvitationState = {};

export function ResendButton({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState(
    resendInvitationAction,
    empty,
  );

  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="invitationId" value={invitationId} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? 'Refreshing…' : 'Resend'}
        </Button>
      </form>
      {state.formError && (
        <p className="text-[11px] text-red-600">{state.formError}</p>
      )}
      {state.ok && state.acceptUrl && (
        <input
          readOnly
          value={state.acceptUrl}
          onFocusCapture={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-mono"
        />
      )}
    </div>
  );
}
