'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createDailyReportAction,
  updateDailyReportAction,
  type DailyReportFormState,
} from '../actions';
import {
  dailyReportStatusValues,
  STATUS_LABEL,
} from '../schema';
import { ManpowerRows, type ManpowerDraft } from './manpower-rows';

export type DailyReportFormInitial = {
  reportDate: string;
  status: (typeof dailyReportStatusValues)[number];
  weatherCondition: string;
  weatherTemperatureF: string;
  weatherPrecipitation: string;
  weatherWind: string;
  weatherHumidity: string;
  weatherSource: 'manual' | 'auto';
  siteConditions: string;
  crewCompanyName: string;
  foremanName: string;
  workPerformed: string;
  materialsDelivered: string;
  equipmentOnSite: string;
  inspections: string;
  delays: string;
  safetyIncidents: string;
  visitorsOnSite: string;
  issuesConcerns: string;
  tomorrowPlan: string;
  internalNotes: string;
  clientNotes: string;
  preparedByName: string;
  includeWeatherInExport: boolean;
  includeManpowerInExport: boolean;
  includeWorkInExport: boolean;
  includeMaterialsInExport: boolean;
  includeEquipmentInExport: boolean;
  includeDelaysInExport: boolean;
  includeSafetyInExport: boolean;
  includeIssuesInExport: boolean;
  includePhotosInExport: boolean;
  includeClientNotesInExport: boolean;
  manpower: ManpowerDraft[];
};

const today = () => new Date().toISOString().slice(0, 10);

export const blankInitial = (): DailyReportFormInitial => ({
  reportDate: today(),
  status: 'draft',
  weatherCondition: '',
  weatherTemperatureF: '',
  weatherPrecipitation: '',
  weatherWind: '',
  weatherHumidity: '',
  weatherSource: 'manual',
  siteConditions: '',
  crewCompanyName: '',
  foremanName: '',
  workPerformed: '',
  materialsDelivered: '',
  equipmentOnSite: '',
  inspections: '',
  delays: '',
  safetyIncidents: '',
  visitorsOnSite: '',
  issuesConcerns: '',
  tomorrowPlan: '',
  internalNotes: '',
  clientNotes: '',
  preparedByName: '',
  includeWeatherInExport: true,
  includeManpowerInExport: true,
  includeWorkInExport: true,
  includeMaterialsInExport: true,
  includeEquipmentInExport: true,
  includeDelaysInExport: true,
  includeSafetyInExport: true,
  includeIssuesInExport: false,
  includePhotosInExport: true,
  includeClientNotesInExport: true,
  manpower: [],
});

type Mode =
  | { kind: 'create'; projectId: string }
  | { kind: 'edit'; projectId: string; reportId: string };

export function DailyReportForm({
  mode,
  projectName,
  projectLocation,
  initial,
}: {
  mode: Mode;
  projectName: string;
  projectLocation: string;
  initial?: DailyReportFormInitial;
}) {
  const values = initial ?? blankInitial();
  const isEdit = mode.kind === 'edit';
  const cancelHref =
    mode.kind === 'edit'
      ? (`/projects/${mode.projectId}/daily-reports/${mode.reportId}` as const)
      : (`/projects/${mode.projectId}/daily-reports` as const);

  // Bind path params into the server action signature so useActionState
  // sees a (prev, formData) => state function.
  const boundAction =
    mode.kind === 'create'
      ? createDailyReportAction.bind(null, mode.projectId)
      : updateDailyReportAction.bind(null, mode.projectId, mode.reportId);

  const initialState: DailyReportFormState = {};
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle>Report details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Report date" error={err('reportDate')}>
            <Input
              type="date"
              name="reportDate"
              defaultValue={values.reportDate}
              required
            />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={values.status}>
              {dailyReportStatusValues.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prepared by">
            <Input
              name="preparedByName"
              defaultValue={values.preparedByName}
              placeholder="Name"
            />
          </Field>
          <Field label="Project">
            <Input value={projectName} readOnly className="bg-slate-50" />
          </Field>
          <Field label="Project location" className="md:col-span-2">
            <Input
              value={projectLocation}
              readOnly
              className="bg-slate-50"
              placeholder="No jobsite address on file"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Weather</CardTitle>
            <span className="text-xs text-slate-500">
              Manual entry. Auto-fetch lands in a follow-up.
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input type="hidden" name="weatherSource" value="manual" />
          <Field label="Condition">
            <Input
              name="weatherCondition"
              defaultValue={values.weatherCondition}
              placeholder="Sunny, Partly cloudy…"
            />
          </Field>
          <Field label="Temperature (°F)">
            <Input
              name="weatherTemperatureF"
              type="number"
              step="0.1"
              defaultValue={values.weatherTemperatureF}
            />
          </Field>
          <Field label="Humidity">
            <Input
              name="weatherHumidity"
              defaultValue={values.weatherHumidity}
              placeholder="e.g. 65%"
            />
          </Field>
          <Field label="Precipitation / Rain">
            <Input
              name="weatherPrecipitation"
              defaultValue={values.weatherPrecipitation}
              placeholder="None, Light rain…"
            />
          </Field>
          <Field label="Wind">
            <Input
              name="weatherWind"
              defaultValue={values.weatherWind}
              placeholder="Calm, 10 mph SW…"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Site conditions & crew lead</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Site conditions" className="md:col-span-2">
            <TextArea
              name="siteConditions"
              defaultValue={values.siteConditions}
              rows={2}
            />
          </Field>
          <Field label="Crew / Company on site">
            <Input
              name="crewCompanyName"
              defaultValue={values.crewCompanyName}
            />
          </Field>
          <Field label="Foreman / Supervisor">
            <Input name="foremanName" defaultValue={values.foremanName} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manpower</CardTitle>
        </CardHeader>
        <CardContent>
          <ManpowerRows initial={values.manpower} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily narrative</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Work performed today" className="md:col-span-2">
            <TextArea
              name="workPerformed"
              defaultValue={values.workPerformed}
              rows={4}
            />
          </Field>
          <Field label="Materials delivered">
            <TextArea
              name="materialsDelivered"
              defaultValue={values.materialsDelivered}
              rows={3}
            />
          </Field>
          <Field label="Equipment on site">
            <TextArea
              name="equipmentOnSite"
              defaultValue={values.equipmentOnSite}
              rows={3}
            />
          </Field>
          <Field label="Inspections">
            <TextArea
              name="inspections"
              defaultValue={values.inspections}
              rows={2}
            />
          </Field>
          <Field label="Delays">
            <TextArea name="delays" defaultValue={values.delays} rows={2} />
          </Field>
          <Field label="Safety incidents">
            <TextArea
              name="safetyIncidents"
              defaultValue={values.safetyIncidents}
              rows={2}
            />
          </Field>
          <Field label="Visitors on site">
            <TextArea
              name="visitorsOnSite"
              defaultValue={values.visitorsOnSite}
              rows={2}
            />
          </Field>
          <Field label="Issues / Concerns">
            <TextArea
              name="issuesConcerns"
              defaultValue={values.issuesConcerns}
              rows={2}
            />
          </Field>
          <Field label="Tomorrow's planned work">
            <TextArea
              name="tomorrowPlan"
              defaultValue={values.tomorrowPlan}
              rows={2}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Internal notes (never appear on client export)">
            <TextArea
              name="internalNotes"
              defaultValue={values.internalNotes}
              rows={4}
            />
          </Field>
          <Field label="Client-facing notes">
            <TextArea
              name="clientNotes"
              defaultValue={values.clientNotes}
              rows={4}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client export settings</CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Choose which sections to include when exporting this report for the
            client. Internal notes are never exported.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          <Toggle name="includeWeatherInExport" label="Weather" defaultChecked={values.includeWeatherInExport} />
          <Toggle name="includeManpowerInExport" label="Manpower" defaultChecked={values.includeManpowerInExport} />
          <Toggle name="includeWorkInExport" label="Work performed" defaultChecked={values.includeWorkInExport} />
          <Toggle name="includeMaterialsInExport" label="Materials delivered" defaultChecked={values.includeMaterialsInExport} />
          <Toggle name="includeEquipmentInExport" label="Equipment" defaultChecked={values.includeEquipmentInExport} />
          <Toggle name="includeDelaysInExport" label="Delays" defaultChecked={values.includeDelaysInExport} />
          <Toggle name="includeSafetyInExport" label="Safety" defaultChecked={values.includeSafetyInExport} />
          <Toggle name="includeIssuesInExport" label="Issues / Concerns" defaultChecked={values.includeIssuesInExport} />
          <Toggle name="includePhotosInExport" label="Photos" defaultChecked={values.includePhotosInExport} />
          <Toggle name="includeClientNotesInExport" label="Client notes" defaultChecked={values.includeClientNotesInExport} />
        </CardContent>
      </Card>

      {state.formError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.formError}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create report'}
        </Button>
        <Link href={cancelHref}>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={
        'flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50 ' +
        (className ?? '')
      }
    />
  );
}

function Toggle({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 cursor-pointer hover:bg-slate-50">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300"
      />
      <span className="text-slate-800">{label}</span>
    </label>
  );
}
