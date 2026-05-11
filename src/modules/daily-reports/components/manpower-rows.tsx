'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ManpowerDraft = {
  companyCrew: string;
  trade: string;
  workerCount: string;
  hours: string;
  notes: string;
};

const blankRow = (): ManpowerDraft => ({
  companyCrew: '',
  trade: '',
  workerCount: '',
  hours: '',
  notes: '',
});

export function ManpowerRows({
  initial,
}: {
  initial?: ManpowerDraft[];
}) {
  const [rows, setRows] = useState<ManpowerDraft[]>(
    initial && initial.length > 0 ? initial : [blankRow()],
  );

  const totalMen = useMemo(
    () => rows.reduce((sum, r) => sum + (parseInt(r.workerCount, 10) || 0), 0),
    [rows],
  );

  // Posted as a single JSON string. The server action validates with zod
  // and replaces all rows atomically.
  const payload = useMemo(
    () =>
      rows.map((r) => ({
        companyCrew: r.companyCrew,
        trade: r.trade,
        workerCount: parseInt(r.workerCount, 10) || 0,
        hours: parseFloat(r.hours) || 0,
        notes: r.notes,
      })),
    [rows],
  );

  function update(idx: number, patch: Partial<ManpowerDraft>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function add() {
    setRows((prev) => [...prev, blankRow()]);
  }
  function remove(idx: number) {
    setRows((prev) =>
      prev.length === 1 ? [blankRow()] : prev.filter((_, i) => i !== idx),
    );
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="manpowerJson" value={JSON.stringify(payload)} />
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Total workers on site: <span className="font-semibold tabular-nums">{totalMen}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          + Add row
        </Button>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div
            key={i}
            className="rounded-md border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-12 gap-2"
          >
            <div className="md:col-span-3">
              <Label className="text-[10px]">Company / Crew</Label>
              <Input
                value={r.companyCrew}
                onChange={(e) => update(i, { companyCrew: e.target.value })}
                placeholder="TRB Roofing Crew"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px]">Trade</Label>
              <Input
                value={r.trade}
                onChange={(e) => update(i, { trade: e.target.value })}
                placeholder="Roofing"
              />
            </div>
            <div className="md:col-span-1">
              <Label className="text-[10px]"># Men</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={r.workerCount}
                onChange={(e) => update(i, { workerCount: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px]">Hours</Label>
              <Input
                type="number"
                min={0}
                step="0.25"
                value={r.hours}
                onChange={(e) => update(i, { hours: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-[10px]">Notes</Label>
              <Input
                value={r.notes}
                onChange={(e) => update(i, { notes: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div className="md:col-span-1 flex md:items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(i)}
                className="w-full text-red-600 hover:text-red-700"
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
