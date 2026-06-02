// New daily report — mobile flow.
//
// Two states determined by the query string:
//
//   /field/reports/new                — show a project picker. The worker
//                                       taps a project; we redirect to
//                                       this same route with ?project=<id>.
//   /field/reports/new?project=<id>   — show the report form. The action
//                                       is .bind(null, projectId) so the
//                                       existing createDailyReportAction
//                                       works unchanged.
//
// We deliberately split into two steps so the form component can take a
// concrete projectId at render time — bind happens server-side.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { getCurrentUser } from '@/lib/auth';
import { getProject, listProjects } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { listAssignmentsForEmployeeDate } from '@/lib/data/project-assignments';
import { createDailyReportAction } from '@/modules/daily-reports/actions';
import { MobileDailyReportForm } from '@/modules/field/components/daily-report-form';
import { todayISOInTZ } from '@/lib/tz';

export const dynamic = 'force-dynamic';

export default async function FieldReportNewPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);

  const companyId = await getActiveCompanyId();
  const employee = await getActiveEmployee();

  const params = await searchParams;
  const projectId = params.project;

  // STATE 2 — project selected → render the form.
  if (projectId) {
    const project = await getProject(companyId, projectId);
    if (!project) redirect('/field/reports/new' as never);

    // Bind the projectId into the action so useActionState can call it
    // with just (prev, formData). Server-side binding only — never
    // trust a client-supplied projectId on the action itself.
    const boundAction = createDailyReportAction.bind(null, project.id);

    // Date defaults to today in the business TZ (America/Nassau), not
    // server-local — the Vercel server runs in UTC and would otherwise
    // prefill tomorrow's date for evening reports.
    const todayIso = todayISOInTZ();

    return (
      <div className="px-4 py-5 space-y-5">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold text-slate-900">
            New report
          </h1>
          <Link
            href={{ pathname: '/field/reports/new' }}
            className="text-xs text-slate-500"
          >
            ← Change project
          </Link>
        </header>
        <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
          {project.name}
        </div>

        <MobileDailyReportForm
          action={boundAction}
          defaultDate={todayIso}
          defaultPreparedByName={
            employee
              ? `${employee.firstName} ${employee.lastName}`.trim()
              : user.name
          }
        />
      </div>
    );
  }

  // STATE 1 — no project selected → pick one. Prioritise today's
  // assignments so the worker doesn't have to scroll a long list.
  const allProjects = await listProjects(companyId);
  const activeProjects = allProjects.filter(
    (p) => p.status !== 'closed' && p.status !== 'lost',
  );

  const todayIso = todayISOInTZ();
  const todaysAssignments = employee
    ? await listAssignmentsForEmployeeDate(employee.id, todayIso)
    : [];
  const assignedProjectIds = new Set(todaysAssignments.map((a) => a.projectId));

  // Bucket: assigned-today first, then everything else. Hydrate with
  // customer for the right-hand line in each card.
  const hydrated = await Promise.all(
    activeProjects.map(async (p) => ({
      project: p,
      customer: await getCustomer(companyId, p.customerId),
      assignedToday: assignedProjectIds.has(p.id),
    })),
  );
  const sorted = [
    ...hydrated.filter((h) => h.assignedToday),
    ...hydrated.filter((h) => !h.assignedToday),
  ];

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          Which project?
        </h1>
        <Link
          href={{ pathname: '/field/reports' }}
          className="text-xs text-slate-500"
        >
          ← Back
        </Link>
      </header>

      {todaysAssignments.length > 0 && (
        <p className="text-xs text-slate-500">
          Your jobs for today appear first.
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center">
          <p className="text-sm text-slate-700">
            No active projects. Ask your supervisor to start one.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map(({ project, customer, assignedToday }) => (
            <li key={project.id}>
              <Link
                href={{
                  pathname: '/field/reports/new',
                  query: { project: project.id },
                }}
                className="block rounded-xl border border-slate-200 bg-white px-4 py-3 active:scale-[0.99] hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {project.name}
                    </p>
                    {customer && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {customer.name}
                      </p>
                    )}
                  </div>
                  {assignedToday && (
                    <span className="text-[10px] uppercase tracking-wide rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700 font-medium shrink-0">
                      Today
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Fallback for users who don't want to pick from the visible list —
          they can also start one from the desktop side later. */}
      <p className="text-[11px] text-slate-400 text-center">
        Don&apos;t see your project? Ask your supervisor — only active
        projects show here.
      </p>

      {/* Render the bound type without using it — keeps the import alive
          even though state 1 doesn't use the action. Plus stops a lint
          warning about an unused import in the future. */}
      <Button type="button" disabled className="hidden">
        {/* sentinel */}
      </Button>
    </div>
  );
}
