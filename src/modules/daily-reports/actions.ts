'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import { getActiveEmployee } from '@/lib/active-employee';
import { todayISOInTZ } from '@/lib/tz';
import {
  createDailyReport,
  updateDailyReport,
  voidDailyReport,
  softDeleteDailyReport,
  getDailyReport,
  listDailyReportsForProject,
  getManpowerForReport,
  createPhotoRecord,
  updatePhotoRecord,
  deletePhotoRecord,
  DailyReportsNotAvailableInDemoError,
  DuplicateDailyReportDateError,
  type ManpowerRowInput,
} from '@/lib/data/daily-reports';
import {
  uploadDailyReportPhoto,
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  PhotoStorageNotConfiguredError,
} from '@/lib/storage/daily-report-photos';
import {
  dailyReportFormSchema,
  manpowerListSchema,
  photoCategoryValues,
  type DailyReportFormInput,
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

// Shared field patch for update + autosave (everything except the immutable
// create-only columns). menOnSite is derived from the manpower rows.
function toReportPatch(
  data: DailyReportFormInput,
  userId: string,
  menOnSite: number,
) {
  return {
    reportDate: data.reportDate,
    status: data.status,
    weatherCondition: emptyToNull(data.weatherCondition),
    weatherTemperatureF:
      data.weatherTemperatureF.trim() === ''
        ? null
        : data.weatherTemperatureF.trim(),
    weatherPrecipitation: emptyToNull(data.weatherPrecipitation),
    weatherWind: emptyToNull(data.weatherWind),
    weatherHumidity: emptyToNull(data.weatherHumidity),
    weatherSource: data.weatherSource,
    siteConditions: emptyToNull(data.siteConditions),
    menOnSite,
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
    updatedBy: userId,
  };
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
  // Mobile flow (Phase M4): when the form was submitted from /field/*,
  // redirect back into the field route group so the worker stays in
  // their phone-sized layout and can immediately add photos. Desktop
  // submitters get the original detail URL.
  const from = (formData.get('from') ?? '').toString();
  if (from === 'field') {
    revalidatePath(`/field/reports/${createdId}`);
    // Cast through `never` to bypass typed-routes literal narrowing —
    // /field/reports/[id] is a fresh route the registry hasn't caught
    // up to yet. The runtime accepts the templated string fine.
    redirect(`/field/reports/${createdId}` as never);
  }
  redirect(`/projects/${project.id}/daily-reports/${createdId}` as never);
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
      toReportPatch(data, user.id, manpower.total),
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
  // Field submitters stay in the mobile shell — back to the same editor so
  // they can keep adding photos / tweaking after a save.
  const from = (formData.get('from') ?? '').toString();
  if (from === 'field') {
    revalidatePath(`/field/reports/${reportId}`);
    revalidatePath('/field/reports');
    redirect(`/field/reports/${reportId}` as never);
  }
  redirect(`/projects/${projectId}/daily-reports/${reportId}`);
}

export type AutosaveState = { savedAt?: string; error?: string };

// Debounced background save for the field editor. Same write as the update
// action but without redirect or revalidate, so the worker keeps typing
// while the draft persists. Called directly from the client (not a form
// submit) and bound with (projectId, reportId).
export async function autosaveDailyReportAction(
  _projectId: string,
  reportId: string,
  formData: FormData,
): Promise<AutosaveState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) return { error: 'No permission.' };
  const idCheck = idSchema.safeParse(reportId);
  if (!idCheck.success) return { error: 'Invalid report id.' };
  const companyId = await getActiveCompanyId();

  const parsed = dailyReportFormSchema.safeParse(readForm(formData));
  if (!parsed.success) return { error: 'Some fields need fixing.' };
  const data = parsed.data;
  const manpower = parseManpowerRows(data.manpowerJson);
  if ('error' in manpower) return { error: manpower.error };

  try {
    const updated = await updateDailyReport(
      companyId,
      reportId,
      toReportPatch(data, user.id, manpower.total),
      manpower.rows,
    );
    if (!updated) return { error: 'Report not found.' };
  } catch (err) {
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : 'Save failed.' };
  }
  return { savedAt: new Date().toISOString() };
}

// Field create flow (Phase B): tapping a project makes/returns TODAY's draft
// for that project, then drops the worker straight into the mobile editor.
// Get-or-create keeps it idempotent — re-tapping a job resumes the same
// report rather than tripping the one-report-per-(project,date) rule.
export async function startFieldReportAction(
  projectId: string,
  _formData: FormData,
): Promise<void> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    redirect('/field/reports' as never);
  }
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) redirect('/field/reports/new' as never);

  const today = todayISOInTZ();

  // Resume an existing report for this (project, today) if there is one.
  const existing = await listDailyReportsForProject(companyId, project.id);
  const open = existing.find(
    (r) => r.reportDate === today && r.status !== 'void',
  );
  if (open) {
    redirect(`/field/reports/${open.id}` as never);
  }

  const employee = await getActiveEmployee();
  const preparedByName = employee
    ? `${employee.firstName} ${employee.lastName}`.trim()
    : user.name;

  // Carry forward the crew from this job's most recent prior report so the
  // worker barely retypes — same crew is on site most days. Editable after.
  const prior = existing
    .filter((r) => r.reportDate < today && r.status !== 'void')
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  let carryRows: ManpowerRowInput[] = [];
  if (prior) {
    const priorCrew = await getManpowerForReport(prior.id);
    carryRows = priorCrew.map((m, i) => ({
      companyCrew: m.companyCrew,
      trade: m.trade,
      workerCount: m.workerCount,
      hours: m.hours,
      notes: m.notes,
      sortOrder: i,
    }));
  }
  const carryMenOnSite = carryRows.reduce((s, r) => s + r.workerCount, 0);

  const location = [
    project.jobsiteAddressLine1,
    project.jobsiteCity,
    project.jobsiteState,
    project.jobsitePostalCode,
  ]
    .filter(Boolean)
    .join(', ');

  let newId: string;
  try {
    const created = await createDailyReport(
      {
        companyId,
        projectId: project.id,
        createdBy: user.id,
        updatedBy: user.id,
        reportDate: today,
        status: 'draft',
        projectNameSnapshot: project.name,
        projectLocationSnapshot: location || null,
        weatherCondition: null,
        weatherTemperatureF: null,
        weatherPrecipitation: null,
        weatherWind: null,
        weatherHumidity: null,
        weatherSource: 'manual',
        weatherObservedAt: null,
        siteConditions: null,
        menOnSite: carryMenOnSite,
        crewCompanyName: null,
        foremanName: null,
        workPerformed: null,
        materialsDelivered: null,
        equipmentOnSite: null,
        inspections: null,
        delays: null,
        safetyIncidents: null,
        visitorsOnSite: null,
        issuesConcerns: null,
        tomorrowPlan: null,
        internalNotes: null,
        clientNotes: null,
        preparedByName: preparedByName || null,
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
      },
      carryRows,
    );
    newId = created.id;
  } catch (err) {
    // Lost a race (another tab created today's report first) — resume it.
    if (err instanceof DuplicateDailyReportDateError) {
      const again = await listDailyReportsForProject(companyId, project.id);
      const dupe = again.find(
        (r) => r.reportDate === today && r.status !== 'void',
      );
      if (dupe) redirect(`/field/reports/${dupe.id}` as never);
    }
    throw err;
  }

  revalidatePath('/field/reports');
  redirect(`/field/reports/${newId}` as never);
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

// ===========================================================================
// Photo actions
// ===========================================================================

export type PhotoActionState = {
  formError?: string;
  ok?: boolean;
};

export async function uploadPhotoAction(
  projectId: string,
  reportId: string,
  _prev: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    return { formError: 'You do not have permission to upload photos.' };
  }
  const companyId = await getActiveCompanyId();
  const report = await getDailyReport(companyId, reportId);
  if (!report) return { formError: 'Daily report not found.' };

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return { formError: 'Choose a photo to upload.' };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return {
      formError: `Photo is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is ${Math.round(
        MAX_PHOTO_BYTES / 1024 / 1024,
      )}MB.`,
    };
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_PHOTO_MIME.has(mime)) {
    return {
      formError: `Unsupported file type: ${file.type || 'unknown'}. Use JPG, PNG, WebP, or HEIC.`,
    };
  }

  const captionRaw = (formData.get('caption') ?? '').toString();
  const categoryRaw = (formData.get('category') ?? 'progress').toString();
  const visibleRaw =
    formData.get('visibleToClient') === 'on' ||
    formData.get('visibleToClient') === 'true';
  const category = (photoCategoryValues as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as (typeof photoCategoryValues)[number])
    : 'progress';

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = await uploadDailyReportPhoto({
      companyId,
      projectId: report.projectId,
      reportId: report.id,
      bytes,
      mimeType: mime,
    });
    await createPhotoRecord({
      dailyReportId: report.id,
      projectId: report.projectId,
      companyId,
      storagePath: upload.storagePath,
      fileName: file.name || null,
      mimeType: mime,
      byteSize: file.size,
      caption: emptyToNull(captionRaw),
      category,
      visibleToClient: visibleRaw,
      uploadedBy: user.id,
      sortOrder: 0,
    });
  } catch (err) {
    if (err instanceof PhotoStorageNotConfiguredError) {
      return { formError: err.message };
    }
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Photo upload failed: ${message}` };
  }

  revalidatePath(`/projects/${projectId}/daily-reports/${reportId}`);
  return { ok: true };
}

export async function updatePhotoAction(
  projectId: string,
  reportId: string,
  photoId: string,
  _prev: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    return { formError: 'You do not have permission to edit photos.' };
  }
  const companyId = await getActiveCompanyId();

  const captionRaw = (formData.get('caption') ?? '').toString();
  const categoryRaw = (formData.get('category') ?? 'progress').toString();
  const visibleRaw =
    formData.get('visibleToClient') === 'on' ||
    formData.get('visibleToClient') === 'true';
  const category = (photoCategoryValues as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as (typeof photoCategoryValues)[number])
    : 'progress';

  try {
    const out = await updatePhotoRecord(companyId, photoId, {
      caption: emptyToNull(captionRaw),
      category,
      visibleToClient: visibleRaw,
    });
    if (!out) return { formError: 'Photo not found.' };
  } catch (err) {
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save photo: ${message}` };
  }
  revalidatePath(`/projects/${projectId}/daily-reports/${reportId}`);
  return { ok: true };
}

export async function deletePhotoAction(
  projectId: string,
  reportId: string,
  photoId: string,
  _prev: PhotoActionState,
  _formData: FormData,
): Promise<PhotoActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    return { formError: 'You do not have permission to delete photos.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const out = await deletePhotoRecord(companyId, photoId);
    if (!out) return { formError: 'Photo not found.' };
  } catch (err) {
    if (err instanceof DailyReportsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to delete photo: ${message}` };
  }
  revalidatePath(`/projects/${projectId}/daily-reports/${reportId}`);
  return { ok: true };
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
