// Today's-jobs list. The field worker opens this to remember: where am I
// going, who's the customer, what's the address. Each job card is a
// tap target — tapping it jumps to the clock screen with that project
// pre-selected so punching in is one extra tap.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { listAssignmentsForEmployeeDate } from '@/lib/data/project-assignments';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { todayISOInTZ, formatDateLongInTZ } from '@/lib/tz';

export const dynamic = 'force-dynamic';

export default async function FieldJobsPage() {
  const employee = await getActiveEmployee();
  if (!employee) redirect('/field' as never);
  const companyId = await getActiveCompanyId();

  // Today's date (YYYY-MM-DD) in the business timezone. The server runs
  // in UTC, so neither toISOString() NOR `now.getDate()` gives the Nassau
  // calendar day — both shift a day early in the evening. todayISOInTZ
  // resolves the wall-clock day in APP_TZ explicitly.
  const todayIso = todayISOInTZ();

  const assignments = await listAssignmentsForEmployeeDate(
    employee.id,
    todayIso,
  );

  // Hydrate each assignment with the project + customer so the card can
  // render address, customer name, scope. N+1 here is fine: a worker
  // typically has 1-3 assignments per day, max ~5.
  const cards = await Promise.all(
    assignments.map(async (a) => {
      const project = await getProject(companyId, a.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      return {
        assignment: a,
        project,
        customer,
      };
    }),
  );

  const friendlyDate = formatDateLongInTZ(new Date());

  return (
    <div className="px-4 py-5 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Today&apos;s jobs
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">{friendlyDate}</p>
      </header>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center space-y-2">
          <p className="text-base font-medium text-slate-900">
            No jobs scheduled for today.
          </p>
          <p className="text-xs text-slate-500">
            Check with your supervisor, or wait for an assignment. You can
            still clock in to general / yard time from the Clock screen.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map(({ assignment, project, customer }) => {
            if (!project) {
              return (
                <li
                  key={assignment.id}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
                >
                  An assigned project is no longer available — ask your
                  supervisor.
                </li>
              );
            }
            const addrLines = [
              project.jobsiteAddressLine1,
              project.jobsiteAddressLine2,
              [
                project.jobsiteCity,
                project.jobsiteState,
                project.jobsitePostalCode,
              ]
                .filter(Boolean)
                .join(' '),
            ].filter(Boolean);
            return (
              <li key={assignment.id}>
                {/*
                  Link to /field/clock with project pre-selected. The
                  clock page reads the latest event's project for the
                  carry-forward default; here we pre-seed via query so
                  the picker lands on the right job for first punch-in.
                */}
                <Link
                  href={{
                    pathname: '/field/clock',
                    query: { project: project.id },
                  }}
                  className="block rounded-xl border border-slate-200 bg-white px-5 py-4 active:scale-[0.99] hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-base font-semibold text-slate-900">
                        {project.name}
                      </p>
                      {customer && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {customer.name}
                        </p>
                      )}
                      {assignment.roleLabel && (
                        <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 mt-2">
                          {assignment.roleLabel}
                        </span>
                      )}
                    </div>
                    <span
                      className="text-slate-400 text-xl leading-none"
                      aria-hidden
                    >
                      ›
                    </span>
                  </div>

                  {addrLines.length > 0 && (
                    <p className="text-sm text-slate-700 mt-3 whitespace-pre-line">
                      {addrLines.join('\n')}
                    </p>
                  )}

                  {assignment.notes && (
                    <p className="text-xs text-slate-700 mt-3 rounded-md bg-blue-50 border border-blue-200 px-2 py-1.5">
                      📌 {assignment.notes}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-slate-400 text-center">
        Tap a job to clock in with it pre-selected.
      </p>
    </div>
  );
}
