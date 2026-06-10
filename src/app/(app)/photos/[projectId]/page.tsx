// Photos browser — per-project gallery. Every photo a project's daily reports
// have collected, in one place, with per-photo download and a link back to the
// source report (the photos still live in those reports — this is just a view).

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { listPhotosForProject } from '@/lib/data/daily-reports';
import { createSignedPhotoUrl } from '@/lib/storage/daily-report-photos';

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

  const cards = await Promise.all(
    photos.map(async (p) => ({
      photo: p,
      url: await createSignedPhotoUrl(p.storagePath).catch(() => null),
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {cards.map(({ photo, url }) => (
            <div
              key={photo.id}
              className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col"
            >
              <div className="aspect-square bg-slate-100">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={photo.caption ?? 'Daily report photo'}
                      className="w-full h-full object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-slate-400">
                    Unavailable
                  </div>
                )}
              </div>
              <div className="p-2 space-y-1 text-xs flex-1">
                <div className="flex items-center justify-between gap-1">
                  <Badge tone="slate">{photo.category}</Badge>
                  <span className="text-slate-400 tabular-nums">
                    {photo.uploadedAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                {photo.caption && (
                  <p className="text-slate-700 line-clamp-2">{photo.caption}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Link
                    href={{
                      pathname: `/projects/${projectId}/daily-reports/${photo.dailyReportId}`,
                    }}
                    className="text-blue-600 hover:underline"
                  >
                    Report →
                  </Link>
                  <a
                    href={`/api/photos/download/${photo.id}`}
                    className="text-slate-600 hover:text-slate-900 font-medium"
                  >
                    Download
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
