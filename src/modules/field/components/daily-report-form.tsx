'use client';

// Mobile-first daily report form. A trimmed-down sibling of the desktop
// daily-report-form — same underlying action and schema, but only the
// fields a field worker actually fills in at the end of a shift.
//
// Laid out as clean, labeled cards (Weather · Crew · Work · Sign-off) so
// it reads like a guided checklist on a phone instead of one long form.
//
// Crew rows are submitted as a JSON blob (`manpowerJson`) — that's the
// shape the existing action expects.

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

  const [rows, setRows] = useState<CrewRow[]>([blankRow()]);

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

  // Live roll-up shown in the Crew card header so the worker can sanity-check
  // the count before submitting (matches the desktop "men on site" total).
  const totalWorkers = rows.reduce(
    (s, r) => s + (Number(r.workerCount) || 0),
    0,
  );
  const totalHours = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {/* Hidden status — draft by default. */}
      <input type="hidden" name="status" value="draft" />
      <input type="hidden" name="weatherSource" value="manual" />
      {/* Redirect back into the mobile shell after save. */}
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
          defaultValue={defaultDate}
          required
          className="text-base md:text-sm h-12 md:h-10"
        />
        {err('reportDate') && (
          <p className="text-xs text-red-600">{err('reportDate')}</p>
        )}
      </Section>

      {/* Weather */}
      <Section icon="☀️" title="Weather" hint="Quick conditions for the day.">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="weatherCondition" className="text-xs">
              Condition
            </Label>
            <Select name="weatherCondition" id="weatherCondition" defaultValue="">
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
          error={err('workPerformed')}
        />
        <FieldTextarea
          name="materialsDelivered"
          label="Materials delivered"
          placeholder="3 squares shingles, 2 rolls ice & water"
          rows={2}
        />
        <FieldTextarea
          name="delays"
          label="Delays / weather hold"
          rows={2}
        />
        <FieldTextarea
          name="tomorrowPlan"
          label="Plan for tomorrow"
          rows={2}
        />
      </Section>

      {/* Sign-off */}
      <Section icon="✍️" title="Sign-off">
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
      </Section>

      <Button
        type="submit"
        disabled={pending}
        className="w-full h-14 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white"
      >
        {pending ? 'Saving…' : 'Save report'}
      </Button>
      <p className="text-[11px] text-slate-500 text-center pb-2">
        Saves as a draft. The next screen has big{' '}
        <strong>📷 Take photo</strong> / <strong>🖼️ Gallery</strong> buttons to
        add pictures from your phone.
      </p>
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
  error,
}: {
  name: string;
  label: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
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
        // 16px font so the OS doesn't pinch-zoom on focus.
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
