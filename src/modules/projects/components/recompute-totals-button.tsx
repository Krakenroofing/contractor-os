'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import {
  recomputeProjectTotalsAction,
  type RecomputeTotalsState,
} from '../actions';

export function RecomputeTotalsButton({ projectId }: { projectId: string }) {
  const bound = recomputeProjectTotalsAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<
    RecomputeTotalsState,
    FormData
  >(bound, {});

  return (
    <form action={formAction} className="space-y-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Recomputing…' : 'Recompute totals from approved COs'}
      </Button>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
      {state.ok && state.result && (
        <p className="text-xs text-emerald-700 tabular-nums">
          Recomputed: original {formatMoney(state.result.originalContractValue)}{' '}
          + approved COs {formatMoney(state.result.approvedCOTotal)} = revised{' '}
          {formatMoney(state.result.newContractValue)}.
        </p>
      )}
    </form>
  );
}
