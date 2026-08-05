// Photos browser — per-project gallery. Every photo a project's daily reports
// have collected, in one place, with per-photo download, multi-select batch
// download (by day or hand-picked), and a link back to the source report
// (the photos still live in those reports — this is just a view).

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { listPhotosForProject } from '@/lib/data/daily-reports';
import { createSignedPhotoUrl } from '@/lib/storage/daily-report-photos';
import {
  PhotoGalleryClient,
  type PhotoCard,
} from '@/modules/photos/components/photo-gallery-client';

export const dynamic = 'force-dynamic';

export default async function ProjectPhotosPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'daily_reports')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const { projectId } = await params;

  const project = await getProject(companyId, projectId);
  if (!project) notFound();

  const [customer, photos] = await Promise.all([
    getCustomer(companyId, project.customerId),
    listPhotosForProject(companyId, projectId),
  ]);

  const cards: PhotoCard[] = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      url: await createSignedPhotoUrl(p.storagePath).catch(() => null),
      category: p.category,
      date: p.uploadedAt.toISOString().slice(0, 10),
      caption: p.caption,
      reportHref: `/projects/${projectId}/daily-reports/${p.dailyReportId}`,
      downloadHref: `/api/photos/download/${p.id}`,
    })),
  );

  return (
    <div className="p-8 space-y-6 max-w-[100rem]">
      <Link
        href={{ pathname: '/photos' }}
        className="text-xs text-slate-500 hover:text-slate-900"
      >
        ← All projects
      </Link>

      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project.name}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {customer?.name ?? '—'} · {photos.length} photo
            {photos.length === 1 ? '' : 's'} from daily reports
          </p>
        </div>
        {photos.length > 0 && (
          <a
            href={`/api/photos/download-all/${projectId}`}
            className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Download all ({photos.length})
          </a>
        )}
      </header>

      {photos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
          No photos for this project yet. They show up here as crews add them to
          daily reports.
        </div>
      ) : (
        <PhotoGalleryClient projectId={projectId} cards={cards} />
      )}
    </div>
  );
}
