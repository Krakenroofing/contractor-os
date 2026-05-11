'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import {
  createDailyReport,
  updateDailyReport,
  voidDailyReport,
  softDeleteDailyReport,
  DailyReportsNotAvailableInDemoError,
  DuplicateDailyReportDateError,
  type ManpowerRowInput,
} from '@/lib/data/daily-reports';
import {
  dailyReportFormSchema,
  manpowerListSchema,
} from './schema';

export type DailyReportFormState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function readForm(formData: FormData) {
  const includeKey = (k: string) => formData.get(k) === 'on' || formData.get(k) === 'true';
  return {
    reportDate: formData.get('reportDate') ?? '',
    status: formData.get('status') ?? 'draft',
    weatherCondition: formData.get('weatherCondition') ?? '',
    weatherTemperatureF: formData.get('weatherTemperatureF') ?? '',
    weatherPrecipitation: formData.get('weatherPrecipitation') ?? '',
    weatherWind: formData.get('weatherWind') ?? '',
    weatherHumidity: formData.get('weatherHumidity') ?? '',
    weatherSource: formData.get('weatherSource') ?? 'manual',
    siteConditions: formData.get('siteConditions') ?? '',
    crewCompanyName: formData.get('crewCompanyName') ?? '',
    foremanName: formData.get('foremanName') ?? '',
    workPerformed: formData.get('workPerformed') ?? '',
    materialsDelivered: formData.get('materialsDelivered') ?? '',
    equipmentOnSite: formData.get('equipmentOnSite') ?? '',
    inspections: formData.get('inspections') ?? '',
    delays: formData.get('delays') ?? '',
    safetyIncidents: formData.get('safetyIncidents') ?? '',
    visitorsOnSite: formData.get('visitorsOnSite') ?? '',
    issuesConcerns: formData.get('issuesConcerns') ?? '',
    tomorrowPlan: formData.get('tomorrowPlan') ?? '',
    internalNotes: formData.get('internalNotes') ?? '',
    clientNotes: formData.get('clientNotes') ?? '',
    preparedByName: formData.get('preparedByName') ?? '',
    includeWeatherInExport: includeKey('includeWeatherInExport'),
    includeManpowerInExport: includeKey('includeManpowerInExport'),
    includeWorkInExport: includeKey('includeWorkInExport'),
    includeMaterialsInExport: includeKey('includeMaterialsInExport'),
    includeEquipmentInExport: includeKey('includeEquipmentInExport'),
    includeDelaysInExport: includeKey('includeDelaysInExport'),
    includeSafetyInExport: includeKey('includeSafetyInExport'),
    includeIssuesInExport: includeKey('includeIssuesInExport'),
    includePhotosInExport: includeKey('includePhotosInExport'),
    includeClientNotesInExport: includeKey('includeClientNotesInExport'),
    manpowerJson: formData.get('manpowerJson') ?? '[]',
  };
}

function parseManpowerRows(raw: string): {
  rows: ManpowerRowInput[];
  total: number;
} | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Manpower rows are malformed.' };
  }
  const validated = manpowerListSchema.safeParse(parsed);
  if (!validated.success) {
    return { error: 'Manpower rows have invalid values.' };
  }
  const rows: ManpowerRowInput[] = validated.data
    .filter(
      (r) =>
        (r.companyCrew?.trim().length ?? 0) > 0 ||
        (r.trade?.trim().length ?? 0) > 0 ||
        r.workerCount > 0 ||
        r.hours > 0,
    )
    .map((r, i) => ({
      companyCrew: emptyToNull(r.companyCrew),
      trade: emptyToNull(r.trade),
      workerCount: r.workerCount,
      hours: r.hours.toFixed(2),
      notes: emptyToNull(r.notes),
      sortOrder: i,
    }));
  const total = rows.reduce((sum, r) => sum + r.workerCount, 0);
  return { rows, total };
}

const idSchema = z.string().uuid('Missing or invalid id');

export async function createDailyReportAction(
  projectId: string,
  _prev: DailyReportFormState,
  formData: FormData,
): Promise<DailyReportFormState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    return { formError: 'You do not have permission to create daily reports.' };
  }

  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) {
    return { formError: 'Project not found in the active company.' };
  }

  const parsed = dailyReportFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const manpower = parseManpowerRows(data.manpowerJson);
  if ('error' in manpower) {
    return { formError: manpower.error };
  }

  const location = [
    project.jobsiteAddressLine1,
    project.jobsiteCity,
    project.jobsiteState,
    project.jobsitePostalCode,
  ]
    .filter(Boolean)
    .join(', ');

  let createdId: string;
  try {
    const created = await createDailyReport(
      {
        companyId,
        projectId: project.id,
        createdBy: user.id,
        updatedBy: user.id,
        reportDate: data.reportDate,
        status: data.status,
        projectNameSnapshot: project.name,
        projectLocationSnapshot: location || null,
        weatherCondition: emptyToNull(data.weatherCondition),
        weatherTemperatureF: data.weatherTemperatureF.trim() === ''
          ? null
          : data.weatherTemperatureF.trim(),
        weatherPrecipitation: emptyToNull(data.weatherPrecipitation),
        weatherWind: emptyToNull(data.weatherWind),
        weatherHumidity: emptyToNull(data.weatherHumidity),
        weatherSource: data.weatherSource,
        weatherObservedAt: null,
        siteConditions: emptyToNull(data.siteConditions),
        menOnSite: manpower.total,
        crewCompanyName: emptyToNull(data.crewCompanyName),
        foremanName: emptyToNull(data.foremanName),
        workPerformed: emptyToNull(data.workPerformed),
        materialsDelivered: emptyToNull(data.materialsDelivered),
        equipmentOnSite: emptyToNull(data.equipmentOnSite),
        inspections: emptyToNull(data.inspections),
        delays: emptyToNull(data.delays),
        safetyIncidents: emptyToNull(data.safetyIncidents),
        visitorsOnSite: emptyToNull(data.visitorsOnSite),
        issuesConcerns: emptyToNull(data.issuesConcerns),
        tomorrowPlan: emptyToNull(data.tomorrowPlan),
        internalNotes: emptyToNull(data.internalNotes),
        clientNotes: emptyToNull(data.clientNotes),
        preparedByName: emptyToNull(data.preparedByName),
        includeWeatherInExport: data.includeWeatherInExport,
        includeManpowerInExport: data.includeManpowerInExport,
        includeWorkInExport: data.includeWorkInExport,
        includeMaterialsInExport: data.includeMaterialsInExport,
        includeEquipmentInExport: data.includeEquipmentInExport,
        includeDelaysInExport: data.includeDelaysInExport,
        includeSafetyInExport: data.includeSafetyInExport,
        includeIssuesInExport: data.includeIssuesInExport,
        includePhotosInExport: data.includePhotosInExport,
        includeClientNotesInExport: data.includeClientNotesInExport,
      },
      manpower.rows,
    );
    createdId = created.id;
  } catch (err) {
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    if (err instanceof DuplicateDailyReportDateError) {
      return { errors: { reportDate: [err.message] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create daily report: ${message}` };
  }

  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/daily-reports`);
  redirect(`/projects/${project.id}/daily-reports/${createdId}`);
}

export async function updateDailyReportAction(
  projectId: string,
  reportId: string,
  _prev: DailyReportFormState,
  formData: FormData,
): Promise<DailyReportFormState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    return { formError: 'You do not have permission to edit daily reports.' };
  }

  const idCheck = idSchema.safeParse(reportId);
  if (!idCheck.success) {
    return { formError: 'Missing or invalid report id.' };
  }
  const companyId = await getActiveCompanyId();

  const parsed = dailyReportFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const manpower = parseManpowerRows(data.manpowerJson);
  if ('error' in manpower) {
    return { formError: manpower.error };
  }

  try {
    const updated = await updateDailyReport(
      companyId,
      reportId,
      {
        reportDate: data.reportDate,
        status: data.status,
        weatherCondition: emptyToNull(data.weatherCondition),
        weatherTemperatureF: data.weatherTemperatureF.trim() === ''
          ? null
          : data.weatherTemperatureF.trim(),
        weatherPrecipitation: emptyToNull(data.weatherPrecipitation),
        weatherWind: emptyToNull(data.weatherWind),
        weatherHumidity: emptyToNull(data.weatherHumidity),
        weatherSource: data.weatherSource,
        siteConditions: emptyToNull(data.siteConditions),
        menOnSite: manpower.total,
        crewCompanyName: emptyToNull(data.crewCompanyName),
        foremanName: emptyToNull(data.foremanName),
        workPerformed: emptyToNull(data.workPerformed),
        materialsDelivered: emptyToNull(data.materialsDelivered),
        equipmentOnSite: emptyToNull(data.equipmentOnSite),
        inspections: emptyToNull(data.inspections),
        delays: emptyToNull(data.delays),
        safetyIncidents: emptyToNull(data.safetyIncidents),
        visitorsOnSite: emptyToNull(data.visitorsOnSite),
        issuesConcerns: emptyToNull(data.issuesConcerns),
        tomorrowPlan: emptyToNull(data.tomorrowPlan),
        internalNotes: emptyToNull(data.internalNotes),
        clientNotes: emptyToNull(data.clientNotes),
        preparedByName: emptyToNull(data.preparedByName),
        includeWeatherInExport: data.includeWeatherInExport,
        includeManpowerInExport: data.includeManpowerInExport,
        includeWorkInExport: data.includeWorkInExport,
        includeMaterialsInExport: data.includeMaterialsInExport,
        includeEquipmentInExport: data.includeEquipmentInExport,
        includeDelaysInExport: data.includeDelaysInExport,
        includeSafetyInExport: data.includeSafetyInExport,
        includeIssuesInExport: data.includeIssuesInExport,
        includePhotosInExport: data.includePhotosInExport,
        includeClientNotesInExport: data.includeClientNotesInExport,
        updatedBy: user.id,
      },
      manpower.rows,
    );
    if (!updated) {
      return { formError: 'Daily report not found.' };
    }
  } catch (err) {
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    if (err instanceof DuplicateDailyReportDateError) {
      return { errors: { reportDate: [err.message] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save daily report: ${message}` };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/daily-reports`);
  revalidatePath(`/projects/${projectId}/daily-reports/${reportId}`);
  redirect(`/projects/${projectId}/daily-reports/${reportId}`);
}

export type SimpleState = { formError?: string };

export async function voidDailyReportAction(
  projectId: string,
  reportId: string,
  _prev: SimpleState,
  _formData: FormData,
): Promise<SimpleState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    return { formError: 'You do not have permission to void daily reports.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const out = await voidDailyReport(companyId, reportId, user.id);
    if (!out) return { formError: 'Daily report not found.' };
  } catch (err) {
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to void report: ${message}` };
  }
  revalidatePath(`/projects/${projectId}/daily-reports`);
  revalidatePath(`/projects/${projectId}/daily-reports/${reportId}`);
  return {};
}

export async function deleteDailyReportAction(
  projectId: string,
  reportId: string,
  _prev: SimpleState,
  _formData: FormData,
): Promise<SimpleState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    return { formError: 'You do not have permission to delete daily reports.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const out = await softDeleteDailyReport(companyId, reportId);
    if (!out) return { formError: 'Daily report not found.' };
  } catch (err) {
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to delete report: ${message}` };
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/daily-reports`);
  redirect(`/projects/${projectId}/daily-reports`);
}
