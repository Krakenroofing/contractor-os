'use client';

// Mobile-first work-order form for the field app. The crew member fills in
// the service call — date, who requested it, everyone on the call with
// hours, materials with quantities, and the repairs done — and submits.
// The office reviews it from the dashboard, adds the client, invoices, and
// posts it to job costing.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { downscalePhotoForUpload } from '@/lib/images/downscale-photo';
import {
  submitWorkOrderAction,
  uploadWorkOrderPhotoAction,
} from '../actions';

type EmployeeOption = { id: string; name: string };

type LaborRow = { employeeId: string; hoursText: string };
type MaterialRow = { name: string; qtyText: string; unit: string };

export function FieldWorkOrderForm({
  selfEmployeeId,
  employees,
  todayIso,
}: {
  selfEmployeeId: string;
  employees: EmployeeOption[];
  todayIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [workDate, setWorkDate] = useState(todayIso);
  const [requestedBy, setRequestedBy] = useState('');
  const [repairsDone, setRepairsDone] = useState('');
  const [labor, setLabor] = useState<LaborRow[]>([
    { employeeId: selfEmployeeId, hoursText: '' },
  ]);
  const [materials, setMaterials] = useState<MaterialRow[]>([
    { name: '', qtyText: '', unit: '' },
  ]);
  // Job photos queued locally; uploaded one-by-one AFTER the work order is
  // created (the storage path needs its id). Downscaled client-side so a
  // 10MB camera shot never trips Vercel's ~4.5MB request cap.
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoProgress, setPhotoProgress] = useState<string | null>(null);

  const nameById = new Map(employees.map((e) => [e.id, e.name]));
  const chosen = new Set(labor.map((l) => l.employeeId));
  const addable = employees.filter((e) => !chosen.has(e.id));

  function setLaborRow(i: number, patch: Partial<LaborRow>) {
    setLabor((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }
  function setMaterialRow(i: number, patch: Partial<MaterialRow>) {
    setMaterials((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }

  function submit() {
    setError(null);
    const laborRows = labor
      .filter((l) => l.employeeId)
      .map((l) => ({
        employeeId: l.employeeId,
        hours: Number(l.hoursText) || 0,
      }));
    const materialRows = materials
      .filter((m) => m.name.trim())
      .map((m) => ({
        name: m.name.trim(),
        quantity: Number(m.qtyText) || 1,
        unit: m.unit.trim() || undefined,
      }));
    if (!repairsDone.trim()) {
      setError('Describe the repairs done — the office needs it to invoice.');
      return;
    }
    startTransition(async () => {
      const res = await submitWorkOrderAction({
        workDate,
        requestedBy: requestedBy.trim(),
        repairsDone: repairsDone.trim(),
        labor: laborRows,
        materials: materialRows,
      });
      if (!res.ok || !res.id) {
        setError(res.error ?? 'Could not submit the work order.');
        return;
      }
      // Photos ride after the create — one at a time so a flaky connection
      // fails loudly per photo instead of losing the whole batch.
      let failed = 0;
      for (let i = 0; i < photos.length; i++) {
        setPhotoProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
        try {
          const fd = new FormData();
          fd.set('photo', await downscalePhotoForUpload(photos[i]));
          const up = await uploadWorkOrderPhotoAction(res.id, fd);
          if (!up.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }
      setPhotoProgress(
        failed > 0
          ? `${failed} photo${failed === 1 ? '' : 's'} failed to upload — you can retry from My work orders later.`
          : null,
      );
      setDone(res.number ?? 'Submitted');
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center space-y-2">
        <p className="text-lg font-semibold text-emerald-900">
          {done} submitted ✓
        </p>
        <p className="text-sm text-emerald-800">
          The office will review it, add the client, and invoice the call.
        </p>
        {photoProgress && (
          <p className="text-xs text-amber-800">{photoProgress}</p>
        )}
        <Button type="button" onClick={() => router.push('/field' as never)}>
          Back to home
        </Button>
      </div>
    );
  }

  if (pending && photoProgress) {
    // Keep the crew member on a clear progress screen while photos upload.
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-center space-y-2">
        <p className="text-base font-semibold text-slate-900">
          Submitting work order…
        </p>
        <p className="text-sm text-slate-600">{photoProgress}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Date + requested by */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Date of the call
          </label>
          <Input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="h-11"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Who requested the call?
          </label>
          <Input
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="Name and phone if you have it"
            className="h-11"
          />
        </div>
      </section>

      {/* Crew + hours */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-900">
          Who was on the call?
        </p>
        {labor.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 text-sm text-slate-800">
              {l.employeeId === selfEmployeeId ? (
                <span className="font-medium">
                  {nameById.get(l.employeeId) ?? 'Me'}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    (you)
                  </span>
                </span>
              ) : (
                <Select
                  value={l.employeeId}
                  onChange={(e) =>
                    setLaborRow(i, { employeeId: e.target.value })
                  }
                >
                  <option value="">— pick employee —</option>
                  {employees
                    .filter(
                      (e) => e.id === l.employeeId || !chosen.has(e.id),
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </Select>
              )}
            </div>
            <Input
              value={l.hoursText}
              onChange={(e) => setLaborRow(i, { hoursText: e.target.value })}
              inputMode="decimal"
              placeholder="hrs"
              className="h-11 w-20 text-right tabular-nums"
            />
            {l.employeeId !== selfEmployeeId && (
              <button
                type="button"
                onClick={() =>
                  setLabor((prev) => prev.filter((_, idx) => idx !== i))
                }
                className="px-2 text-lg text-slate-400"
                aria-label="Remove person"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {addable.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setLabor((prev) => [...prev, { employeeId: '', hoursText: '' }])
            }
          >
            + Add someone else on the call
          </Button>
        )}
      </section>

      {/* Materials */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-900">Materials used</p>
        {materials.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={m.name}
              onChange={(e) => setMaterialRow(i, { name: e.target.value })}
              placeholder="Material (e.g. shingles, sealant)"
              className="h-11 flex-1"
            />
            <Input
              value={m.qtyText}
              onChange={(e) => setMaterialRow(i, { qtyText: e.target.value })}
              inputMode="decimal"
              placeholder="qty"
              className="h-11 w-16 text-right tabular-nums"
            />
            <Input
              value={m.unit}
              onChange={(e) => setMaterialRow(i, { unit: e.target.value })}
              placeholder="unit"
              className="h-11 w-16"
            />
            <button
              type="button"
              onClick={() =>
                setMaterials((prev) => prev.filter((_, idx) => idx !== i))
              }
              className="px-1 text-lg text-slate-400"
              aria-label="Remove material"
            >
              ×
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setMaterials((prev) => [
              ...prev,
              { name: '', qtyText: '', unit: '' },
            ])
          }
        >
          + Add material
        </Button>
      </section>

      {/* Job photos */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <p className="text-sm font-semibold text-slate-900">Job photos</p>
        <p className="text-xs text-slate-500">
          Before / after shots of the repair. They go to the office with the
          work order and can end up on the client&apos;s invoice.
        </p>
        <Input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
          multiple
          className="h-11"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) setPhotos((prev) => [...prev, ...files]);
            e.target.value = '';
          }}
        />
        {photos.length > 0 && (
          <ul className="space-y-1">
            {photos.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 text-xs text-slate-700"
              >
                <span className="truncate">
                  📷 {f.name || `Photo ${i + 1}`}{' '}
                  <span className="text-slate-400">
                    ({(f.size / 1024 / 1024).toFixed(1)}MB)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPhotos((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="px-2 text-base text-slate-400"
                  aria-label="Remove photo"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Repairs done */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <p className="text-sm font-semibold text-slate-900">Repairs done</p>
        <textarea
          value={repairsDone}
          onChange={(e) => setRepairsDone(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="What was wrong and what you did to fix it"
        />
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        type="button"
        className="w-full h-12 text-base"
        disabled={pending}
        onClick={submit}
      >
        {pending ? 'Submitting…' : 'Submit work order'}
      </Button>
    </div>
  );
}
