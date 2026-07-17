'use client';

// Mobile-first daily report editor. Always edits an existing (draft or
// finished) report — the field create flow now makes a draft up front and
// drops the worker straight here, so this single card-based screen handles
// both "fill it in" and "tweak it later", plus photos, in one place.
//
// Laid out as clean, labeled cards (Date · Weather · Crew · Work · Photos ·
// Sign-off) so it reads like a guided checklist on a phone.
//
// Crew rows are submitted as a JSON blob (`manpowerJson`) — the shape the
// existing update action expects.

import { useActionState, useRef, useState } from 'react';
import { getCurrentPosition } from '@/lib/capacitor/geolocation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { DailyReportFormState } from '@/modules/daily-reports/actions';

const initialState: DailyReportFormState = {};

type Action = (
  prev: DailyReportFormState,
  formData: FormData,
) => Promise<DailyReportFormState>;

type CrewRow = {
  key: string;
  companyCrew: string;
  trade: string;
  workerCount: string;
  hours: string;
};

export type DailyReportInitial = {
  reportDate: string;
  status: string;
  weatherCondition: string;
  weatherTemperatureF: string;
  workPerformed: string;
  materialsDelivered: string;
  delays: string;
  tomorrowPlan: string;
  preparedByName: string;
  rows: Array<{
    companyCrew: string;
    trade: string;
    workerCount: string;
    hours: string;
  }>;
};

let rowSeq = 0;
function keyedRow(r: DailyReportInitial['rows'][number]): CrewRow {
  rowSeq += 1;
  return { key: `r${rowSeq}`, ...r };
}
function blankRow(): CrewRow {
  return keyedRow({ companyCrew: '', trade: '', workerCount: '', hours: '' });
}

type AutosaveResult = { savedAt?: string; error?: string };

export function MobileDailyReportForm({
  action,
  initial,
  photos,
  submitLabel = 'Save',
  autosave,
}: {
  action: Action;
  initial: DailyReportInitial;
  /** Photos card content (gallery + uploader) — rendered by the server page
   *  because signed URLs need server data. */
  photos?: React.ReactNode;
  submitLabel?: string;
  /** Debounced background save. When provided, edits autosave the draft. */
  autosave?: (formData: FormData) => Promise<AutosaveResult>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const [rows, setRows] = useState<CrewRow[]>(
    initial.rows.length > 0 ? initial.rows.map(keyedRow) : [blankRow()],
  );

  const formRef = useRef<HTMLFormElement>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  // Weather is controlled so the "use my location" button can fill it.
  const [weatherCondition, setWeatherCondition] = useState(
    initial.weatherCondition,
  );
  const [weatherTemp, setWeatherTemp] = useState(initial.weatherTemperatureF);
  const [weatherStatus, setWeatherStatus] = useState<
    'idle' | 'locating' | 'error'
  >('idle');

  async function runAutosave() {
    if (!autosave || !formRef.current) return;
    setSaveStatus('saving');
    try {
      const res = await autosave(new FormData(formRef.current));
      setSaveStatus(res?.error ? 'error' : 'saved');
    } catch {
      setSaveStatus('error');
    }
  }

  // Debounce: reschedule on every edit; save 2s after the worker stops.
  function scheduleAutosave() {
    if (!autosave) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(runAutosave, 2000);
  }

  // Location comes through the Capacitor-aware bridge — inside the
  // native shell navigator.geolocation is permission-blocked, so the
  // "use my location" weather shortcut silently failed for the crew.
  async function useMyLocation() {
    setWeatherStatus('locating');
    const fix = await getCurrentPosition();
    if (!fix) {
      setWeatherStatus('error');
      return;
    }
    try {
      const res = await fetch(
        `/api/field/weather?lat=${fix.latitude}&lng=${fix.longitude}`,
      );
      if (!res.ok) throw new Error('weather');
      const data = (await res.json()) as {
        condition?: string;
        temperatureF?: number | null;
      };
      if (data.condition) setWeatherCondition(data.condition);
      if (typeof data.temperatureF === 'number') {
        setWeatherTemp(String(data.temperatureF));
      }
      setWeatherStatus('idle');
      scheduleAutosave();
    } catch {
      setWeatherStatus('error');
    }
  }

  function setRow(i: number, patch: Partial<CrewRow>) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }

  const manpowerJson = JSON.stringify(
    rows.map((r) => ({
      companyCrew: r.companyCrew,
      trade: r.trade,
      workerCount: r.workerCount === '' ? 0 : Number(r.workerCount),
      hours: r.hours === '' ? 0 : Number(r.hours),
    })),
  );

  const totalWorkers = rows.reduce(
    (s, r) => s + (Number(r.workerCount) || 0),
    0,
  );
  const totalHours = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={scheduleAutosave}
      className="space-y-4"
    >
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {/* Preserve the report's status; stay in the mobile shell after save. */}
      <input type="hidden" name="status" value={initial.status} />
      <input type="hidden" name="weatherSource" value="manual" />
      <input type="hidden" name="from" value="field" />
      {/* Export-section toggles — default-on to match desktop-created reports. */}
      <input type="hidden" name="includeWeatherInExport" value="on" />
      <input type="hidden" name="includeManpowerInExport" value="on" />
      <input type="hidden" name="includeWorkInExport" value="on" />
      <input type="hidden" name="includeMaterialsInExport" value="on" />
      <input type="hidden" name="includeEquipmentInExport" value="on" />
      <input type="hidden" name="includeDelaysInExport" value="on" />
      <input type="hidden" name="includeSafetyInExport" value="on" />
      <input type="hidden" name="includePhotosInExport" value="on" />
      <input type="hidden" name="includeClientNotesInExport" value="on" />
      <input type="hidden" name="manpowerJson" value={manpowerJson} />

      {/* Date */}
      <Section icon="📅" title="Date">
        <Input
          id="reportDate"
          name="reportDate"
          type="date"
          defaultValue={initial.reportDate}
          required
          className="text-base md:text-sm h-12 md:h-10"
        />
        {err('reportDate') && (
          <p className="text-xs text-red-600">{err('reportDate')}</p>
        )}
      </Section>

      {/* Weather */}
      <Section icon="☀️" title="Weather" hint="Quick conditions for the day.">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={useMyLocation}
            disabled={weatherStatus === 'locating'}
            className="rounded-md border border-blue-600 text-blue-700 text-xs font-medium px-3 py-1.5 disabled:opacity-50 hover:bg-blue-50"
          >
            {weatherStatus === 'locating' ? 'Getting weather…' : '📍 Use my location'}
          </button>
          {weatherStatus === 'error' && (
            <span className="text-[11px] text-amber-700">
              Couldn&apos;t get weather — pick it below.
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="weatherCondition" className="text-xs">
              Condition
            </Label>
            <Select
              name="weatherCondition"
              id="weatherCondition"
              value={weatherCondition}
              onChange={(e) => {
                setWeatherCondition(e.target.value);
                scheduleAutosave();
              }}
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
              value={weatherTemp}
              onChange={(e) => setWeatherTemp(e.target.value)}
              className="text-base md:text-sm h-12 md:h-10"
            />
          </div>
        </div>
      </Section>

      {/* Crew on site */}
      <Section
        icon="👷"
        title="Crew on site"
        hint="Add each crew or sub working today."
        badge={
          totalWorkers > 0 || totalHours > 0
            ? `${totalWorkers} on site · ${totalHours} hrs`
            : undefined
        }
      >
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
                  onChange={(e) => setRow(i, { companyCrew: e.target.value })}
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
                  onChange={(e) => setRow(i, { workerCount: e.target.value })}
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
          + Add crew
        </Button>
      </Section>

      {/* Work */}
      <Section
        icon="🛠️"
        title="Work"
        hint="What got done today. Only the first box is required."
      >
        <FieldTextarea
          name="workPerformed"
          label="Work performed today"
          placeholder="Tore off east elevation, set drip edge…"
          rows={4}
          required
          defaultValue={initial.workPerformed}
          error={err('workPerformed')}
        />
        <FieldTextarea
          name="materialsDelivered"
          label="Materials delivered"
          placeholder="3 squares shingles, 2 rolls ice & water"
          rows={2}
          defaultValue={initial.materialsDelivered}
        />
        <FieldTextarea
          name="delays"
          label="Delays / weather hold"
          rows={2}
          defaultValue={initial.delays}
        />
        <FieldTextarea
          name="tomorrowPlan"
          label="Plan for tomorrow"
          rows={2}
          defaultValue={initial.tomorrowPlan}
        />
      </Section>

      {/* Photos — rendered by the server page (gallery + uploader). */}
      {photos && (
        <Section icon="📷" title="Photos" hint="Take new ones or add from your gallery.">
          {photos}
        </Section>
      )}

      {/* Sign-off */}
      <Section icon="✍️" title="Sign-off">
        <Label htmlFor="preparedByName" className="text-xs">
          Submitted by
        </Label>
        <Input
          id="preparedByName"
          name="preparedByName"
          defaultValue={initial.preparedByName}
          maxLength={200}
          className="text-base md:text-sm h-12 md:h-10"
        />
      </Section>

      {autosave && (
        <p className="text-[11px] text-center h-4">
          {saveStatus === 'saving' && (
            <span className="text-slate-500">Saving…</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-emerald-600">Saved ✓ — changes save automatically</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-amber-700">
              Couldn&apos;t auto-save — tap {submitLabel} to save.
            </span>
          )}
          {saveStatus === 'idle' && (
            <span className="text-slate-400">Changes save automatically.</span>
          )}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="w-full h-14 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white"
      >
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

function Section({
  icon,
  title,
  hint,
  badge,
  children,
}: {
  icon: string;
  title: string;
  hint?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2.5 border-b border-slate-100">
        <span className="text-lg leading-none" aria-hidden>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
        </div>
        {badge && (
          <span className="shrink-0 rounded-full bg-blue-50 text-blue-700 text-[11px] font-medium px-2.5 py-1 tabular-nums">
            {badge}
          </span>
        )}
      </div>
      <div className="px-4 py-3 space-y-3">{children}</div>
    </section>
  );
}

function FieldTextarea({
  name,
  label,
  placeholder,
  rows = 3,
  required,
  defaultValue,
  error,
}: {
  name: string;
  label: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  defaultValue?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} className="text-xs">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        placeholder={placeholder}
        defaultValue={defaultValue}
        // 16px font so the OS doesn't pinch-zoom on focus.
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
