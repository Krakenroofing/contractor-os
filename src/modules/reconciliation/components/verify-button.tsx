'use client';

import { useActionState, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  markProjectVerifiedAction,
  unmarkProjectVerifiedAction,
  type VerifyState,
} from '@/modules/reconciliation/actions';

const initial: VerifyState = {};

export function VerifyButton({
  projectId,
  verifiedAt,
  verifiedRole,
  verifiedNote,
  allowed,
}: {
  projectId: string;
  verifiedAt: Date | string | null;
  verifiedRole: string | null;
  verifiedNote: string | null;
  /** False when the active role can't change verification — buttons disabled. */
  allowed: boolean;
}) {
  const [markState, markAction, markPending] = useActionState(
    markProjectVerifiedAction,
    initial,
  );
  const [unmarkState, unmarkAction, unmarkPending] = useActionState(
    unmarkProjectVerifiedAction,
    initial,
  );
  const [showNote, setShowNote] = useState(false);

  const isVerified = verifiedAt !== null;
  const formattedDate = verifiedAt
    ? typeof verifiedAt === 'string'
      ? verifiedAt
      : verifiedAt.toLocaleString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })
    : null;

  const error = markState.formError ?? unmarkState.formError;

  if (isVerified) {
    return (
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <Badge tone="green">Verified</Badge>
          <p className="text-xs text-slate-500 mt-1">
            {formattedDate}
            {verifiedRole ? ` · by ${verifiedRole}` : ''}
          </p>
          {verifiedNote && (
            <p className="text-xs text-slate-700 mt-1 italic">
              &ldquo;{verifiedNote}&rdquo;
            </p>
          )}
        </div>
        {allowed && (
          <form action={unmarkAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={unmarkPending}
            >
              {unmarkPending ? 'Clearing…' : 'Un-verify'}
            </Button>
          </form>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <form action={markAction} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      {showNote && (
        <input
          name="note"
          maxLength={2000}
          placeholder="Optional note (e.g. cross-checked vs. QuickBooks)"
          className="flex w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <Button type="submit" size="sm" disabled={markPending || !allowed}>
          {markPending ? 'Marking…' : 'Mark as verified'}
        </Button>
        {!showNote && allowed && (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="text-xs text-slate-500 hover:underline"
          >
            + add a note
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!allowed && (
        <p className="text-xs text-slate-500">
          Your role cannot change verification status.
        </p>
      )}
    </form>
  );
}
