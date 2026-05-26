'use client';

// Mobile-first daily report form. A trimmed-down sibling of the desktop
// daily-report-form — same underlying action and schema, but only the
// fields a field worker actually fills in at the end of a shift.
//
// Crew rows are submitted as a JSON blob (`manpowerJson`) — that's the
// shape the existing action expects. We let the worker add multiple
// crews (e.g. roofing + electrician sub on the same day) without a
// fancy editor: each "Add crew row" appends a new bag of fields.

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { DailyReportFormState } from '@/modules/daily-reports/actions';

const initial: DailyReportFormState = {};

type Action = (
  prev: DailyReportFormState,
  formData: FormData,
) => Promise<DailyReportFormState>;

type CrewRow = {
  // Stable key for React; we re-generate ids on add, not from row data.
  key: string;
  companyCrew: string;
  trade: string;
  workerCount: string;
  hours: string;
};

function blankRow(): CrewRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    companyCrew: '',
    trade: '',
    workerCount: '',
    hours: '',
  };
}

export function MobileDailyReportForm({
  action,
  defaultDate,
  defaultPreparedByName,
}: {
  action: Action;
  defaultDate: string;
  defaultPreparedByName: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  // Single default row so the form starts useful; worker can fill or
  // leave blank (blank rows are dropped server-side).
  const [rows, setRows] = useState<CrewRow[]>([blankRow()]);

  function setRow(i: number, patch: Partial<CrewRow>) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }

  // Serialised crew rows in the shape the existing action expects
  // (camelCase keys matching manpowerRowSchema). Empty rows are kept
  // here — the server-side parser filters them.
  const manpowerJson = JSON.stringify(
    rows.map((r) => ({
      companyCrew: r.companyCrew,
      trade: r.trade,
      workerCount: r.workerCount === '' ? 0 : Number(r.workerCount),
      hours: r.hours === '' ? 0 : Number(r.hours),
    })),
  );

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {/* Hidden status — draft by default. Worker can mark complete via
          the bottom button row. */}
      <input type="hidden" name="status" value="draft" />
      <input type="hidden" name="weatherSource" value="manual" />
      {/* Tells the action to redirect to /field/reports/:id after save
          so the worker stays in the mobile shell (vs being bounced to
          the desktop daily-report detail). */}
      <input type="hidden" name="from" value="field" />
      {/* Export-section toggles — default-on so the desktop PDF behaves
          identically to a desktop-created report. */}
      <input type="hidden" name="includeWeatherInExport" value="on" />
      <input type="hidden" name="includeManpowerInExport" value="on" />
      <input type="hidden" name="includeWorkInExport" value="on" />
      <input type="hidden" name="includeMaterialsInExport" value="on" />
      <input type="hidden" name="includeEquipmentInExport" value="on" />
      <input type="hidden" name="includeDelaysInExport" value="on" />
      <input type="hidden" name="includeSafetyInExport" value="on" />
      <input type="hidden" name="includePhotosInExport" value="on" />
      <input type="hidden" name="includeClientNotesInExport" value="on" />
      {/* manpowerJson is the hidden ground-truth field; the visible
          inputs below are JS state mirrors so the textarea / number
          inputs feel native to the browser. */}
      <input type="hidden" name="manpowerJson" value={manpowerJson} />

      {/* Date */}
      <div className="space-y-1">
        <Label htmlFor="reportDate" className="text-xs">
          Report date
        </Label>
        <Input
          id="reportDate"
          name="reportDate"
          type="date"
          defaultValue={defaultDate}
          required
          className="text-base md:text-sm h-12 md:h-10"
        />
        {err('reportDate') && (
          <p className="text-xs text-red-600">{err('reportDate')}</p>
        )}
      </div>

      {/* Weather — quick capture, no API. The desktop view has full
          weather fields; mobile keeps it to condition + temp because
          that's what fits comfortably. */}
      <fieldset className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2">
        <legend className="px-1 text-xs font-medium text-slate-700">
          Weather
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="weatherCondition" className="text-xs">
              Condition
            </Label>
            <Select
              name="weatherCondition"
              id="weatherCondition"
              defaultValue=""
            >
              <option value="">—</option>
              <option value="Sunny">Sunny</option>
              <option value="Partly cloudy">Partly cloudy</option>
              <option value="Cloudy">Cloudy</option>
              <option value="Rain">Rain</option>
              <option value="Heavy rain">Heavy rain</option>
              <option value="Wind">Wind</option>
              <option value="Storm">Storm</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="weatherTemperatureF" className="text-xs">
              Temp (°F)
            </Label>
            <Input
              id="weatherTemperatureF"
              name="weatherTemperatureF"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="78"
              className="text-base md:text-sm h-12 md:h-10"
            />
          </div>
        </div>
      </fieldset>

      {/* Crew rows — Sub crew + own crew handled the same. Worker
          counts and hours roll up to the desktop "men on site" total. */}
      <fieldset className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-3">
        <legend className="px-1 text-xs font-medium text-slate-700">
          Crew on site
        </legend>
        {rows.map((row, i) => (
          <div
            key={row.key}
            className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                Crew {i + 1}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="text-[11px] text-red-600"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Company / crew</Label>
                <Input
                  value={row.companyCrew}
                  onChange={(e) =>
                    setRow(i, { companyCrew: e.target.value })
                  }
                  placeholder="Kraken / Sub"
                  maxLength={200}
                  className="text-base md:text-sm h-12 md:h-10"
                />
              </div>
              <div>
                <Label className="text-xs">Trade</Label>
                <Input
                  value={row.trade}
                  onChange={(e) => setRow(i, { trade: e.target.value })}
                  placeholder="Roofing"
                  maxLength={200}
                  className="text-base md:text-sm h-12 md:h-10"
                />
              </div>
              <div>
                <Label className="text-xs"># Workers</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={row.workerCount}
                  onChange={(e) =>
                    setRow(i, { workerCount: e.target.value })
                  }
                  className="text-base md:text-sm h-12 md:h-10"
                />
              </div>
              <div>
                <Label className="text-xs">Hours</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  min="0"
                  value={row.hours}
                  onChange={(e) => setRow(i, { hours: e.target.value })}
                  className="text-base md:text-sm h-12 md:h-10"
                />
              </div>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setRows((prev) => [...prev, blankRow()])}
        >
          + Add crew row
        </Button>
      </fieldset>

      {/* Free-text capture. Big rows because phone keyboards eat half
          the screen — these are the most-likely-to-be-long fields. */}
      <Textarea
        name="workPerformed"
        label="Work performed today"
        placeholder="Tore off east elevation, set drip edge…"
        rows={4}
      />
      <Textarea
        name="materialsDelivered"
        label="Materials delivered (optional)"
        placeholder="3 squares shingles, 2 rolls ice & water"
        rows={2}
      />
      <Textarea
        name="delays"
        label="Delays / weather hold (optional)"
        rows={2}
      />
      <Textarea
        name="tomorrowPlan"
        label="Plan for tomorrow (optional)"
        rows={2}
      />

      <div className="space-y-1">
        <Label htmlFor="preparedByName" className="text-xs">
          Submitted by
        </Label>
        <Input
          id="preparedByName"
          name="preparedByName"
          defaultValue={defaultPreparedByName}
          maxLength={200}
          className="text-base md:text-sm h-12 md:h-10"
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        className="w-full h-14 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white"
      >
        {pending ? 'Saving…' : 'Save report'}
      </Button>
      <p className="text-[11px] text-slate-500 text-center">
        Saves as draft. You can add photos and finalize from the desktop
        view after submitting.
      </p>
    </form>
  );
}

function Textarea({
  name,
  label,
  placeholder,
  rows = 3,
}: {
  name: string;
  label: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} className="text-xs">
        {label}
      </Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        placeholder={placeholder}
        // 16px font + h-auto so the OS doesn't pinch-zoom on focus. Plain
        // <textarea> rather than the desktop Textarea component because
        // that one ships smaller padding designed for dense desktop UIs.
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
    </div>
  );
}
