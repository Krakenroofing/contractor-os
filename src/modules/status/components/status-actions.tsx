'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getTransitions,
  type EntityType,
  type Transition,
} from '@/lib/status-machine';
import {
  transitionStatusAction,
  type TransitionState,
} from '@/modules/status/actions';

const initialState: TransitionState = {};

export function StatusActions({
  entityType,
  entityId,
  status,
  allowed,
}: {
  entityType: EntityType;
  entityId: string;
  status: string;
  /** False when the active role cannot mutate this entity — buttons disabled. */
  allowed: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    transitionStatusAction,
    initialState,
  );
  const transitions = getTransitions(entityType, status);

  if (transitions.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        No further transitions available for this status.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((t) => (
          <SingleActionForm
            key={t.action}
            entityType={entityType}
            entityId={entityId}
            currentStatus={status}
            transition={t}
            disabled={!allowed || pending}
            formAction={formAction}
          />
        ))}
      </div>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {!allowed && (
        <p className="text-xs text-slate-500">
          Your role does not allow status changes on this record.
        </p>
      )}
    </div>
  );
}

function SingleActionForm({
  entityType,
  entityId,
  currentStatus,
  transition,
  disabled,
  formAction,
}: {
  entityType: EntityType;
  entityId: string;
  currentStatus: string;
  transition: Transition;
  disabled: boolean;
  formAction: (formData: FormData) => void;
}) {
  // Mark-Paid on an invoice needs a real payment date so VAT/cash reports
  // get the right quarter. Default to today, but let the user override.
  const needsPaidDate =
    entityType === 'invoice' && transition.action === 'mark_paid';
  const [paidDate, setPaidDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  return (
    <form
      action={formAction}
      className={
        needsPaidDate
          ? 'inline-flex items-end gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1'
          : ''
      }
    >
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="currentStatus" value={currentStatus} />
      <input type="hidden" name="action" value={transition.action} />
      {needsPaidDate && (
        <label className="flex flex-col text-[10px] uppercase tracking-wide text-slate-500">
          Paid date
          <Input
            type="date"
            name="paidDate"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
            className="h-8 text-sm"
          />
        </label>
      )}
      <Button
        type="submit"
        size="sm"
        variant={transition.variant ?? 'default'}
        disabled={disabled}
      >
        {transition.label}
      </Button>
    </form>
  );
}
