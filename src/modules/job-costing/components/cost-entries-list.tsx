'use client';

import { useActionState, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { Select } from '@/components/ui/select';
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
  updateCostEntryAction,
  type CostEntryActionState,
} from '../actions';
import {
  jobCostTypeValues,
  JOB_COST_TYPE_LABEL,
  JOB_COST_TYPE_TONE,
  type JobCostType,
} from '../schema';
import type {
  CostCodeOption,
  VendorOption,
} from './cost-entry-form';

export type CostEntryRow = {
  id: string;
  entryDate: string;
  costCodeId: string;
  costCode: string;
  costCodeDescription: string;
  costType: JobCostType;
  vendorId: string | null;
  vendorName: string | null;
  description: string;
  quantity: string;
  unitCost: string;
  amount: string;
  isBillable: boolean;
  markupPercent: string | null;
  notes: string | null;
  createdByName: string | null;
};

export function CostEntriesList({
  projectId,
  entries,
  costCodes,
  vendors,
  allowEdit,
}: {
  projectId: string;
  entries: CostEntryRow[];
  costCodes: CostCodeOption[];
  vendors: VendorOption[];
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
              <CostEntryTableRow
                key={e.id}
                projectId={projectId}
                entry={e}
                costCodes={costCodes}
                vendors={vendors}
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

// Per-row component holds its own edit-mode state + bound update/delete
// actions. When editing, the row collapses into a single colSpan cell that
// renders a compact form. Cleaner than juggling 10 inline inputs across
// 10 narrow table cells.
function CostEntryTableRow({
  projectId,
  entry,
  costCodes,
  vendors,
  allowEdit,
}: {
  projectId: string;
  entry: CostEntryRow;
  costCodes: CostCodeOption[];
  vendors: VendorOption[];
  allowEdit: boolean;
}) {
  const updateBound = updateCostEntryAction.bind(null, projectId, entry.id);
  const deleteBound = deleteCostEntryAction.bind(null, projectId, entry.id);
  const [updateState, updateAction, updatePending] = useActionState<
    CostEntryActionState,
    FormData
  >(updateBound, {});
  const [, deleteAction] = useActionState<CostEntryActionState, FormData>(
    deleteBound,
    {},
  );
  const [editing, setEditing] = useState(false);

  // Successful save → exit editing.
  if (editing && updateState.ok && !updateState.formError) {
    setEditing(false);
  }

  if (editing && allowEdit) {
    return (
      <TableRow>
        <TableCell colSpan={10} className="bg-slate-50 p-4">
          <form action={updateAction} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-2">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  name="entryDate"
                  defaultValue={entry.entryDate}
                  required
                />
              </div>
              <div className="md:col-span-4">
                <Label className="text-xs">Cost code</Label>
                <Select name="costCodeId" defaultValue={entry.costCodeId} required>
                  {costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.description}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-3">
                <Label className="text-xs">Cost type</Label>
                <Select name="costType" defaultValue={entry.costType}>
                  {jobCostTypeValues.map((t) => (
                    <option key={t} value={t}>
                      {JOB_COST_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-3">
                <Label className="text-xs">Vendor</Label>
                <Select name="vendorId" defaultValue={entry.vendorId ?? ''}>
                  <option value="">—</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="md:col-span-12">
                <Label className="text-xs">Description</Label>
                <Input name="description" defaultValue={entry.description} required />
              </div>

              <div className="md:col-span-2">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  step="0.0001"
                  name="quantity"
                  defaultValue={Number(entry.quantity).toString()}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Unit cost</Label>
                <Input
                  type="number"
                  step="0.0001"
                  name="unitCost"
                  defaultValue={Number(entry.unitCost).toString()}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Total override</Label>
                <Input
                  type="number"
                  step="0.01"
                  name="amount"
                  defaultValue={Number(entry.amount).toString()}
                />
              </div>
              <div className="md:col-span-2 flex items-end">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    name="isBillable"
                    defaultChecked={entry.isBillable}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>Billable</span>
                </label>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Markup %</Label>
                <Input
                  type="number"
                  step="0.001"
                  name="markupPercent"
                  defaultValue={entry.markupPercent ?? ''}
                />
              </div>
              <div className="md:col-span-2" />

              <div className="md:col-span-12">
                <Label className="text-xs">Notes</Label>
                <Input name="notes" defaultValue={entry.notes ?? ''} />
              </div>
            </div>

            {updateState.formError && (
              <p className="text-xs text-red-600">{updateState.formError}</p>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={updatePending}>
                {updatePending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </TableCell>
      </TableRow>
    );
  }

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
        <TableCell className="text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
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
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}
