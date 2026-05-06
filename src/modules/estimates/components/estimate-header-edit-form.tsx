'use client';

// Header-only edit form. Line items, totals, and status transitions are
// NOT editable here — the workflow status panel and the existing
// recreate-with-new-lines flow handle those. Only available while the
// estimate is in `draft` status (the action layer enforces this too).

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  updateEstimateHeaderAction,
  type UpdateEstimateHeaderState,
} from '../actions';

const initial: UpdateEstimateHeaderState = {};

export function EstimateHeaderEditForm({
  id,
  initialValidUntil,
}: {
  id: string;
  initialValidUntil: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateEstimateHeaderAction,
    initial,
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-4">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      <input type="hidden" name="id" value={id} />

      <div className="space-y-1.5">
        <Label htmlFor="validUntil">Valid until</Label>
        <Input
          id="validUntil"
          name="validUntil"
          type="date"
          defaultValue={initialValidUntil}
        />
        {err('validUntil') && (
          <p className="text-xs text-red-600">{err('validUntil')}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Link href={{ pathname: `/estimates/${id}` }}>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
