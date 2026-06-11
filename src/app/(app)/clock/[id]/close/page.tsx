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
import { getSessionCloseInfo } from '@/lib/data/clock-events';
import { getEmployee } from '@/lib/data/employees';
import { listProjects } from '@/lib/data/projects';
import { formatDateTimeLocalInTZ, formatTimeInTZ } from '@/lib/tz';
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
  const info = await getSessionCloseInfo(companyId, id);
  if (!info) notFound();
  const punch = info.inEvent;

  const sp = (await searchParams) ?? {};
  const backHref = sp.date
    ? { pathname: '/clock' as const, query: { date: sp.date } }
    : { pathname: '/clock' as const };

  // Only open sessions can be closed (open = no clock-out within the IN's
  // own day, exactly as the grid shows). If it's already closed, send the
  // user to the day grid for that punch's day where the session now lives.
  if (!info.isOpen) {
    redirect(`/clock?date=${info.inDayISO}` as never);
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
        // The OUT has to land before the worker's next clock-in — pass it
        // through so the picker caps there and the hint explains why.
        maxOccurredAt={
          info.nextInAt ? formatDateTimeLocalInTZ(info.nextInAt) : null
        }
        nextInLabel={info.nextInAt ? formatTimeInTZ(info.nextInAt) : null}
        projectLabel={projectLabel}
      />
    </div>
  );
}
