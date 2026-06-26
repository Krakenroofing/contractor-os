'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createBillFromPoAction,
  type CreateBillFromPoState,
} from '@/modules/purchase-orders/actions';

const initialState: CreateBillFromPoState = {};

/** Action button on the PO detail page. Posts the PO to a draft Bill (receipt)
 *  and redirects to it on success; surfaces a permission / guard error inline. */
export function CreateBillFromPoButton({ poId }: { poId: string }) {
  const [state, formAction, pending] = useActionState(
    createBillFromPoAction,
    initialState,
  );

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="poId" value={poId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Creating bill…' : 'Create bill'}
      </Button>
      {state.formError && (
        <p className="text-xs text-red-600">{state.formError}</p>
      )}
    </form>
  );
}
