// Close an open session — record the missing clock-out for a worker who
// forgot to punch out. Reached from the open-session row on /clock and
// from the "On the clock now" panel. `id` is the dangling IN punch.
//
// Guards mirror the data layer: the IN must still be the employee's
// latest punch (i.e. genuinely open). If it's already closed we bounce
// back to the day grid rather than show a form that would fail on submit.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getClockEvent,
  getLatestClockEvent,
} from '@/lib/data/clock-events';
import { getEmployee } from '@/lib/data/employees';
import { listProjects } from '@/lib/data/projects';
import {
  formatDateTimeLocalInTZ,
  formatTimeInTZ,
  todayISOInTZ,
} from '@/lib/tz';
import { CloseSessionForm } from '@/modules/clock-events/components/close-session-form';

export const dynamic = 'force-dynamic';

export default async function CloseSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ date?: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'clock_events')) redirect('/clock' as never);

  const companyId = await getActiveCompanyId();
  const punch = await getClockEvent(companyId, id);
  if (!punch) notFound();

  const sp = (await searchParams) ?? {};
  const backHref = sp.date
    ? { pathname: '/clock' as const, query: { date: sp.date } }
    : { pathname: '/clock' as const };

  // Only open sessions can be closed: the IN must be the employee's
  // latest punch. If a clock-out already exists, send the user to the
  // day grid for that punch's day where the paired session now lives.
  const latest = await getLatestClockEvent(punch.employeeId);
  if (punch.kind !== 'in' || !latest || latest.id !== punch.id) {
    redirect(`/clock?date=${todayISOInTZ(punch.occurredAt)}` as never);
  }

  const [employee, projects] = await Promise.all([
    getEmployee(companyId, punch.employeeId),
    listProjects(companyId),
  ]);

  const projectLabel = punch.projectId
    ? projects.find((p) => p.id === punch.projectId)?.name ?? '(deleted project)'
    : null;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href={backHref}>
        <Button variant="outline" size="sm">
          ← Back to time clock
        </Button>
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          Record clock-out
        </h1>
        <div className="flex items-center gap-2 flex-wrap text-sm text-slate-600">
          <span>
            {employee
              ? `${employee.firstName} ${employee.lastName}`.trim()
              : 'Unknown employee'}
          </span>
          <Badge tone="amber">still on clock</Badge>
        </div>
      </header>

      <CloseSessionForm
        inId={punch.id}
        // Default to the clock-in instant so the date is already the right
        // day — the office just nudges the time to when work actually ended.
        defaultOccurredAt={formatDateTimeLocalInTZ(punch.occurredAt)}
        inLabel={formatTimeInTZ(punch.occurredAt)}
        projectLabel={projectLabel}
      />
    </div>
  );
}
