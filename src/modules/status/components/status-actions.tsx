'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
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
  return (
    <form action={formAction}>
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="currentStatus" value={currentStatus} />
      <input type="hidden" name="action" value={transition.action} />
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
