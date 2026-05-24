'use client';

// Lists past PO receipts and exposes an undo action per row. Undo reverses
// the per-line quantity bump and recomputes PO status. Used on the PO
// detail page (Phase 6.1).

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  deletePoReceiptAction,
  type DeletePoReceiptState,
} from '../actions';

type ReceiptRow = {
  id: string;
  receivedAt: string;
  notes: string | null;
  totalQty: number;
  lineCount: number;
};

const initial: DeletePoReceiptState = {};

export function PoReceiptHistory({
  poId,
  receipts,
}: {
  poId: string;
  receipts: ReceiptRow[];
}) {
  const [state, formAction, pending] = useActionState(
    deletePoReceiptAction,
    initial,
  );

  if (receipts.length === 0) {
    return (
      <div className="p-6 text-sm text-slate-500">
        No shipments recorded yet against this PO.
      </div>
    );
  }

  return (
    <div>
      {state.formError && (
        <div className="m-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Received</TableHead>
            <TableHead className="text-right">Total qty</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right w-32">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {receipts.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="tabular-nums text-slate-900">
                {r.receivedAt}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.totalQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </TableCell>
              <TableCell className="text-right tabular-nums text-slate-600">
                {r.lineCount}
              </TableCell>
              <TableCell className="text-slate-700">{r.notes ?? '—'}</TableCell>
              <TableCell className="text-right">
                <form
                  action={formAction}
                  onSubmit={(e) => {
                    if (
                      !window.confirm(
                        'Reverse this receipt? Per-line received quantities will be decremented and the PO status will recompute.',
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="receiptId" value={r.id} />
                  <input type="hidden" name="purchaseOrderId" value={poId} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                  >
                    Undo
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
