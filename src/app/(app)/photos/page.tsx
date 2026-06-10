// Photos browser — index. Lists projects (with photo counts + a cover) so the
// office can jump into any project's photo gallery. Read-only over the same
// daily_report_photos records; nothing is moved out of the daily reports.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { listProjectPhotoSummaries } from '@/lib/data/daily-reports';
import { createSignedPhotoUrl } from '@/lib/storage/daily-report-photos';

export const dynamic = 'force-dynamic';

export default async function PhotosIndexPage() {
  const role = await getActiveRole();
  if (!canView(role, 'daily_reports')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();

  const [projects, customers, summaries] = await Promise.all([
    listProjects(companyId),
    listCustomers(companyId),
    listProjectPhotoSummaries(companyId),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  // Projects with photos first (by count), then the rest alphabetically.
  const rows = projects
    .map((p) => ({ project: p, summary: summaries.get(p.id) }))
    .sort((a, b) => {
      const ca = a.summary?.count ?? 0;
      const cb = b.summary?.count ?? 0;
      if (cb !== ca) return cb - ca;
      return a.project.name.localeCompare(b.project.name);
    });

  const covers = new Map<string, string | null>();
  await Promise.all(
    rows
      .filter((r) => r.summary)
      .map(async (r) => {
        covers.set(
          r.project.id,
          await createSignedPhotoUrl(r.summary!.coverPath).catch(() => null),
        );
      }),
  );

  const totalPhotos = [...summaries.values()].reduce((s, v) => s + v.count, 0);

  return (
    <div className="p-8 space-y-6 max-w-[100rem]">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Photos</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {totalPhotos} photo{totalPhotos === 1 ? '' : 's'} across{' '}
          {summaries.size} project{summaries.size === 1 ? '' : 's'} — pulled from
          daily reports, grouped by project.
        </p>
      </header>

      {projects.length === 0 ? (
        <p className="text-sm text-slate-500">No projects yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {rows.map(({ project, summary }) => {
            const cover = covers.get(project.id) ?? null;
            const count = summary?.count ?? 0;
            return (
              <Link
                key={project.id}
                href={{ pathname: `/photos/${project.id}` }}
                className="block rounded-xl border border-slate-200 bg-white overflow-hidden hover:shadow-sm transition"
              >
                <div className="aspect-video bg-slate-100">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover}
                      alt={project.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-xs text-slate-400">
                      No photos yet
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {project.name}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {customerName.get(project.customerId) ?? '—'}
                  </p>
                  <div className="mt-1.5">
                    <Badge tone={count > 0 ? 'blue' : 'slate'}>
                      {count} photo{count === 1 ? '' : 's'}
                    </Badge>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
