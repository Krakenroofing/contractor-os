// Mobile daily-report editor (Phase B). One card-based screen that both
// views and edits the report — Date · Weather · Crew · Work · Photos ·
// Sign-off — so the field worker fills it in and adds photos in one place.
// The field create flow lands here on a fresh draft.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser } from '@/lib/auth';
import {
  getDailyReport,
  getManpowerForReport,
  listPhotosForReport,
} from '@/lib/data/daily-reports';
import { getProject } from '@/lib/data/projects';
import { createSignedPhotoUrl } from '@/lib/storage/daily-report-photos';
import {
  STATUS_LABEL as DR_STATUS_LABEL,
  STATUS_TONE as DR_STATUS_TONE,
} from '@/modules/daily-reports/schema';
import {
  updateDailyReportAction,
  uploadPhotoAction,
} from '@/modules/daily-reports/actions';
import { FieldPhotoUpload } from '@/modules/field/components/photo-upload';
import {
  MobileDailyReportForm,
  type DailyReportInitial,
} from '@/modules/field/components/daily-report-form';

export const dynamic = 'force-dynamic';

export default async function FieldReportEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);

  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const showDesktopEditLink = role !== 'field_user';

  const report = await getDailyReport(companyId, id);
  if (!report) notFound();

  const [project, manpower, photos] = await Promise.all([
    getProject(companyId, report.projectId),
    getManpowerForReport(report.id),
    listPhotosForReport(report.id),
  ]);

  const photoCards = await Promise.all(
    photos.map(async (p) => ({
      photo: p,
      url: await createSignedPhotoUrl(p.storagePath).catch(() => null),
    })),
  );

  const boundUpload = uploadPhotoAction.bind(null, report.projectId, report.id);
  const boundUpdate = updateDailyReportAction.bind(
    null,
    report.projectId,
    report.id,
  );

  const initial: DailyReportInitial = {
    reportDate: report.reportDate,
    status: report.status,
    weatherCondition: report.weatherCondition ?? '',
    weatherTemperatureF: report.weatherTemperatureF ?? '',
    workPerformed: report.workPerformed ?? '',
    materialsDelivered: report.materialsDelivered ?? '',
    delays: report.delays ?? '',
    tomorrowPlan: report.tomorrowPlan ?? '',
    preparedByName: report.preparedByName ?? '',
    rows: manpower.map((m) => ({
      companyCrew: m.companyCrew ?? '',
      trade: m.trade ?? '',
      workerCount: m.workerCount > 0 ? String(m.workerCount) : '',
      hours: Number(m.hours) > 0 ? String(m.hours) : '',
    })),
  };

  // Photos card content — gallery + uploader, passed into the form so it
  // sits inline with the other sections.
  const photosNode = (
    <div className="space-y-3">
      {photoCards.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photoCards.map(({ photo, url }) => (
            <li
              key={photo.id}
              className="aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100"
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={photo.caption ?? 'photo'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-[10px] text-slate-400 p-1 text-center">
                  Unable to load
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <FieldPhotoUpload action={boundUpload} />
    </div>
  );

  return (
    <div className="px-4 py-5 space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900 leading-tight">
            {project?.name ?? 'Report'}
          </h1>
          <Badge tone={DR_STATUS_TONE[report.status]}>
            {DR_STATUS_LABEL[report.status]}
          </Badge>
        </div>
        <Link href={{ pathname: '/field/reports' }} className="text-xs text-slate-500">
          ← All reports
        </Link>
      </header>

      <MobileDailyReportForm
        action={boundUpdate}
        initial={initial}
        photos={photosNode}
        submitLabel="Save report"
      />

      {showDesktopEditLink && (
        <Link
          href={{
            pathname: `/projects/${report.projectId}/daily-reports/${report.id}/edit`,
          }}
          className="block text-center text-xs text-slate-500"
        >
          Open full desktop view →
        </Link>
      )}
    </div>
  );
}
