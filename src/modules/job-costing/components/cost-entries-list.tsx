'use client';

import { useActionState, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import {
  deleteCostEntryAction,
  type CostEntryActionState,
} from '../actions';
import {
  jobCostTypeValues,
  JOB_COST_TYPE_LABEL,
  JOB_COST_TYPE_TONE,
  type JobCostType,
} from '../schema';

export type CostEntryRow = {
  id: string;
  entryDate: string;
  costCode: string;
  costCodeDescription: string;
  costType: JobCostType;
  vendorName: string | null;
  description: string;
  quantity: string;
  unitCost: string;
  amount: string;
  isBillable: boolean;
  markupPercent: string | null;
  createdByName: string | null;
};

export function CostEntriesList({
  projectId,
  entries,
  allowEdit,
}: {
  projectId: string;
  entries: CostEntryRow[];
  allowEdit: boolean;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      const matchesSearch =
        q === '' ||
        e.description.toLowerCase().includes(q) ||
        e.costCode.toLowerCase().includes(q) ||
        (e.vendorName ?? '').toLowerCase().includes(q);
      const matchesType = !typeFilter || e.costType === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [entries, search, typeFilter]);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
        No cost data entered yet. Use the form above to record labor, materials,
        equipment, subcontractor costs, freight/duty/VAT, or any other job
        expense.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by description, code, or vendor…"
        filters={[
          {
            label: 'Cost type',
            value: typeFilter,
            onChange: setTypeFilter,
            options: jobCostTypeValues.map((t) => ({
              value: t,
              label: JOB_COST_TYPE_LABEL[t],
            })),
          },
        ]}
        onClear={() => {
          setSearch('');
          setTypeFilter('');
        }}
      />

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Cost code</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Billable</TableHead>
              {allowEdit && <TableHead className="text-right" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <CostEntryRow
                key={e.id}
                projectId={projectId}
                entry={e}
                allowEdit={allowEdit}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered.length === 0 && entries.length > 0 && (
        <div className="text-sm text-slate-500 text-center py-4">
          No entries match those filters.
        </div>
      )}
    </div>
  );
}

function CostEntryRow({
  projectId,
  entry,
  allowEdit,
}: {
  projectId: string;
  entry: CostEntryRow;
  allowEdit: boolean;
}) {
  const deleteBound = deleteCostEntryAction.bind(null, projectId, entry.id);
  const [, deleteAction] = useActionState<CostEntryActionState, FormData>(
    deleteBound,
    {},
  );

  return (
    <TableRow>
      <TableCell className="text-slate-700 text-xs whitespace-nowrap">
        {entry.entryDate}
      </TableCell>
      <TableCell>
        <div className="font-mono text-xs text-slate-700">{entry.costCode}</div>
        <div className="text-[11px] text-slate-500">{entry.costCodeDescription}</div>
      </TableCell>
      <TableCell>
        <Badge tone={JOB_COST_TYPE_TONE[entry.costType]}>
          {JOB_COST_TYPE_LABEL[entry.costType]}
        </Badge>
      </TableCell>
      <TableCell className="text-slate-700 text-xs">
        {entry.vendorName ?? '—'}
      </TableCell>
      <TableCell className="text-slate-900">
        <div>{entry.description}</div>
        {entry.createdByName && (
          <div className="text-[10px] text-slate-400">by {entry.createdByName}</div>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-xs text-slate-600">
        {Number(entry.quantity).toString()}
      </TableCell>
      <TableCell className="text-right tabular-nums text-xs text-slate-600">
        {formatMoney(entry.unitCost)}
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">
        {formatMoney(entry.amount)}
      </TableCell>
      <TableCell className="text-xs">
        {entry.isBillable ? (
          <span className="text-emerald-700">
            ✓{entry.markupPercent ? ` +${entry.markupPercent}%` : ''}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </TableCell>
      {allowEdit && (
        <TableCell className="text-right">
          <form action={deleteAction}>
            <ConfirmButton
              size="sm"
              variant="destructive"
              confirmLabel="Click again"
              pendingLabel="Deleting…"
            >
              Delete
            </ConfirmButton>
          </form>
        </TableCell>
      )}
    </TableRow>
  );
}
