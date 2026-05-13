'use client';

import { useActionState, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  upsertForecastAction,
  deleteForecastAction,
  type ForecastActionState,
} from '../actions';
import type { CostCodeOption } from './cost-entry-form';

export type ForecastRow = {
  id: string;
  costCodeId: string;
  costCode: string;
  costCodeDescription: string;
  actualToDate: number;
  costToComplete: number;
  projectedFinal: number;
  budgeted: number;
  notes: string | null;
  riskFlag: boolean;
};

export function ForecastList({
  projectId,
  forecasts,
  costCodes,
  allowEdit,
}: {
  projectId: string;
  forecasts: ForecastRow[];
  costCodes: CostCodeOption[];
  allowEdit: boolean;
}) {
  const upsertBound = upsertForecastAction.bind(null, projectId);
  const [upsertState, upsertAction, upsertPending] = useActionState<
    ForecastActionState,
    FormData
  >(upsertBound, {});
  const formRef = useRef<HTMLFormElement>(null);

  const [pickedCodeId, setPickedCodeId] = useState('');

  if (upsertState.ok && !upsertState.formError && formRef.current) {
    formRef.current.reset();
    setPickedCodeId('');
  }

  // Codes that already have a forecast — hidden from the add-form picker.
  const codedSet = new Set(forecasts.map((f) => f.costCodeId));
  const addableCodes = costCodes.filter((c) => !codedSet.has(c.id));

  const totalActual = forecasts.reduce((a, r) => a + r.actualToDate, 0);
  const totalCTC = forecasts.reduce((a, r) => a + r.costToComplete, 0);
  const totalFinal = forecasts.reduce((a, r) => a + r.projectedFinal, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <Stat label="Tracked actual" value={formatMoney(totalActual)} />
        <Stat label="Cost to complete" value={formatMoney(totalCTC)} />
        <Stat
          label="Projected final"
          value={formatMoney(totalFinal)}
          emphasize
        />
      </div>

      {allowEdit && addableCodes.length > 0 && (
        <form
          ref={formRef}
          action={upsertAction}
          className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5">
              <Label className="text-xs">Cost code</Label>
              <Select
                name="costCodeId"
                value={pickedCodeId}
                onChange={(e) => setPickedCodeId(e.target.value)}
                required
                className="bg-white"
              >
                <option value="">Choose…</option>
                {addableCodes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.description}
                  </option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Cost to complete</Label>
              <Input
                type="number"
                step="0.01"
                name="costToComplete"
                required
                className="bg-white tabular-nums"
                placeholder="0.00"
              />
            </div>
            <div className="md:col-span-2 flex items-end">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  name="riskFlag"
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>Risk flag</span>
              </label>
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button type="submit" disabled={upsertPending} className="w-full">
                {upsertPending ? 'Saving…' : 'Add forecast'}
              </Button>
            </div>
            <div className="md:col-span-12">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                name="notes"
                placeholder="Assumptions, contingency, risk explanation…"
                className="bg-white"
              />
            </div>
          </div>
          {upsertState.formError && (
            <p className="text-xs text-red-600">{upsertState.formError}</p>
          )}
        </form>
      )}

      {forecasts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          No cost-to-complete forecasts yet. Add one above to project final
          cost and gross profit.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cost code</TableHead>
                <TableHead className="text-right">Budgeted</TableHead>
                <TableHead className="text-right">Actual to date</TableHead>
                <TableHead className="text-right">Cost to complete</TableHead>
                <TableHead className="text-right">Projected final</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Risk</TableHead>
                {allowEdit && <TableHead className="text-right" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {forecasts.map((f) => (
                <ForecastRowView
                  key={f.id}
                  projectId={projectId}
                  forecast={f}
                  allowEdit={allowEdit}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ForecastRowView({
  projectId,
  forecast,
  allowEdit,
}: {
  projectId: string;
  forecast: ForecastRow;
  allowEdit: boolean;
}) {
  const deleteBound = deleteForecastAction.bind(null, projectId, forecast.id);
  const [, deleteAction] = useActionState<ForecastActionState, FormData>(
    deleteBound,
    {},
  );
  const variance = forecast.budgeted > 0 ? forecast.projectedFinal - forecast.budgeted : 0;

  return (
    <TableRow>
      <TableCell>
        <div className="font-mono text-xs text-slate-700">{forecast.costCode}</div>
        <div className="text-[11px] text-slate-500">{forecast.costCodeDescription}</div>
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-600 text-xs">
        {forecast.budgeted > 0 ? formatMoney(forecast.budgeted) : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {formatMoney(forecast.actualToDate)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatMoney(forecast.costToComplete)}
      </TableCell>
      <TableCell
        className={
          'text-right tabular-nums font-medium ' +
          (forecast.budgeted > 0 && variance > 0
            ? 'text-amber-700'
            : 'text-slate-900')
        }
      >
        {formatMoney(forecast.projectedFinal)}
        {forecast.budgeted > 0 && (
          <div className="text-[10px] text-slate-500">
            {variance > 0 ? '+' : ''}
            {formatMoney(variance)} vs budget
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-slate-600">
        {forecast.notes ?? '—'}
      </TableCell>
      <TableCell>
        {forecast.riskFlag ? <Badge tone="red">⚠ Risk</Badge> : null}
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
              Clear
            </ConfirmButton>
          </form>
        </TableCell>
      )}
    </TableRow>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={
          'mt-1 tabular-nums ' +
          (emphasize ? 'text-lg font-semibold text-slate-900' : 'text-base text-slate-800')
        }
      >
        {value}
      </div>
    </div>
  );
}
