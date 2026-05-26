// Mobile detail view for a single daily report. Lighter than the
// desktop /projects/.../daily-reports/[id] view — the field worker
// mostly wants to confirm "did my report save?" and then add photos
// straight off their camera.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { getActiveCompanyId } from '@/lib/active-company';
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
import { uploadPhotoAction } from '@/modules/daily-reports/actions';
import { FieldPhotoUpload } from '@/modules/field/components/photo-upload';

export const dynamic = 'force-dynamic';

export default async function FieldReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);

  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const report = await getDailyReport(companyId, id);
  if (!report) notFound();

  const [project, manpower, photos] = await Promise.all([
    getProject(companyId, report.projectId),
    getManpowerForReport(report.id),
    listPhotosForReport(report.id),
  ]);

  // Generate signed URLs for thumbnails. Slow if there are many photos
  // (one signed URL = one Supabase call) — fine for a single report's
  // gallery, which is typically ≤20 photos.
  const photoCards = await Promise.all(
    photos.map(async (p) => ({
      photo: p,
      url: await createSignedPhotoUrl(p.storagePath).catch(() => null),
    })),
  );

  // Bind project + report id into the upload action so the form just
  // takes (prev, formData).
  const boundUpload = uploadPhotoAction.bind(null, report.projectId, report.id);

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900 leading-tight">
            {project?.name ?? 'Report'}
          </h1>
          <Badge tone={DR_STATUS_TONE[report.status]}>
            {DR_STATUS_LABEL[report.status]}
          </Badge>
        </div>
        <p className="text-xs text-slate-500">
          {report.reportDate}
          {report.menOnSite > 0 && (
            <>
              <span className="mx-1">·</span>
              {report.menOnSite} on site
            </>
          )}
        </p>
        <Link
          href={{ pathname: '/field/reports' }}
          className="text-xs text-slate-500"
        >
          ← All reports
        </Link>
      </header>

      {/* Photo gallery + capture */}
      <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Photos ({photoCards.length})
          </h2>
        </div>

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
      </section>

      {/* Read-only snapshot of the rest of the report so the worker can
          confirm what saved. Editing happens on the desktop edit page
          (linked at bottom). */}
      {report.weatherCondition && (
        <Field label="Weather">
          {report.weatherCondition}
          {report.weatherTemperatureF && ` · ${report.weatherTemperatureF}°F`}
        </Field>
      )}

      {manpower.length > 0 && (
        <Field label="Crew">
          <ul className="space-y-1">
            {manpower.map((m) => (
              <li key={m.id} className="text-sm text-slate-700">
                {[m.companyCrew, m.trade].filter(Boolean).join(' · ') ||
                  '(unlabeled)'}
                {m.workerCount > 0 && ` — ${m.workerCount}`}
                {Number(m.hours) > 0 && ` × ${m.hours}h`}
              </li>
            ))}
          </ul>
        </Field>
      )}

      {report.workPerformed && (
        <Field label="Work performed">
          <p className="text-sm text-slate-700 whitespace-pre-line">
            {report.workPerformed}
          </p>
        </Field>
      )}

      {report.materialsDelivered && (
        <Field label="Materials delivered">
          <p className="text-sm text-slate-700 whitespace-pre-line">
            {report.materialsDelivered}
          </p>
        </Field>
      )}

      {report.delays && (
        <Field label="Delays">
          <p className="text-sm text-slate-700 whitespace-pre-line">
            {report.delays}
          </p>
        </Field>
      )}

      {report.tomorrowPlan && (
        <Field label="Tomorrow">
          <p className="text-sm text-slate-700 whitespace-pre-line">
            {report.tomorrowPlan}
          </p>
        </Field>
      )}

      <Link
        href={{
          pathname: `/projects/${report.projectId}/daily-reports/${report.id}/edit`,
        }}
        className="block text-center text-xs text-slate-500"
      >
        Need to edit details? Open desktop view →
      </Link>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </section>
  );
}
