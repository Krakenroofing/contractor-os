// Field-side "my daily reports" list. Shows reports this user created
// across all projects, most recent first. Tapping a row jumps to the
// existing desktop view at /projects/:id/daily-reports/:reportId — that
// page is read-only enough on mobile (we'll polish later if needed). A
// big "+ New report" button up top is the primary action.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getActiveCompanyId } from '@/lib/active-company';
import { getCurrentUser } from '@/lib/auth';
import { listDailyReportsForUser } from '@/lib/data/daily-reports';
import { getProject } from '@/lib/data/projects';
import {
  STATUS_LABEL as DR_STATUS_LABEL,
  STATUS_TONE as DR_STATUS_TONE,
} from '@/modules/daily-reports/schema';

export const dynamic = 'force-dynamic';

export default async function FieldReportsListPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);

  const companyId = await getActiveCompanyId();
  const reports = await listDailyReportsForUser(companyId, user.id, 50);

  // Hydrate project names so the worker recognises each row. Small
  // N+1 — capped at 50 reports per fetch above.
  const cards = await Promise.all(
    reports.map(async (r) => ({
      report: r,
      project: await getProject(companyId, r.projectId),
    })),
  );

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">My reports</h1>
        <Link href={{ pathname: '/field' }} className="text-xs text-slate-500">
          ← Home
        </Link>
      </header>

      {/* Primary action — full-width button. Tapping picks a project on
          the next screen. */}
      <Link href={{ pathname: '/field/reports/new' }} className="block">
        <Button
          type="button"
          className="w-full h-14 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white"
        >
          + New daily report
        </Button>
      </Link>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center">
          <p className="text-base font-medium text-slate-900">
            No reports yet.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Reports capture site conditions, crew, work done, and photos.
            Tap the button above to start one.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {cards.map(({ report, project }) => {
            // The full detail view still lives on the desktop route — we
            // route there for now. Phase M4 doesn't include a mobile
            // detail view; that's polish.
            const href = `/projects/${report.projectId}/daily-reports/${report.id}`;
            return (
              <li key={report.id}>
                <Link
                  href={{ pathname: href }}
                  className="block rounded-xl border border-slate-200 bg-white px-4 py-3 active:scale-[0.99] hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {project?.name ?? '(unknown project)'}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {report.reportDate}
                        {report.menOnSite > 0 && (
                          <>
                            <span className="mx-1">·</span>
                            {report.menOnSite} on site
                          </>
                        )}
                      </p>
                    </div>
                    <Badge tone={DR_STATUS_TONE[report.status]}>
                      {DR_STATUS_LABEL[report.status]}
                    </Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
