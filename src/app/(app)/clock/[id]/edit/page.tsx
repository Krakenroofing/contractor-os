// Edit a single clock punch. Reached from the day-grid on /clock.
// Saving re-anchors the wall-clock value as APP_TZ and clears the
// review flag — the office has to re-confirm the session before M6.2
// will post it to payroll.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getClockEvent } from '@/lib/data/clock-events';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { getEmployee } from '@/lib/data/employees';
import { formatDateTimeLocalInTZ } from '@/lib/tz';
import { EditPunchForm } from '@/modules/clock-events/components/edit-punch-form';

export const dynamic = 'force-dynamic';

export default async function EditPunchPage({
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

  const [employee, projects, costCodes] = await Promise.all([
    getEmployee(companyId, punch.employeeId),
    listProjects(companyId),
    listCostCodes(companyId),
  ]);

  const sp = (await searchParams) ?? {};
  const backHref = sp.date
    ? { pathname: '/clock' as const, query: { date: sp.date } }
    : { pathname: '/clock' as const };

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href={backHref}>
        <Button variant="outline" size="sm">
          ← Back to time clock
        </Button>
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          Edit punch
        </h1>
        <div className="flex items-center gap-2 flex-wrap text-sm text-slate-600">
          <span>
            {employee
              ? `${employee.firstName} ${employee.lastName}`.trim()
              : 'Unknown employee'}
          </span>
          <Badge tone={punch.kind === 'in' ? 'green' : 'slate'}>
            {punch.kind === 'in' ? 'Clock IN' : 'Clock OUT'}
          </Badge>
          {punch.reviewedAt && <Badge tone="green">reviewed</Badge>}
        </div>
      </header>

      <EditPunchForm
        punchId={punch.id}
        defaults={{
          occurredAt: formatDateTimeLocalInTZ(punch.occurredAt),
          projectId: punch.projectId ?? '',
          costCodeId: punch.costCodeId ?? '',
          notes: punch.notes ?? '',
        }}
        projects={projects.map((p) => ({ id: p.id, label: p.name }))}
        costCodes={costCodes.map((c) => ({
          id: c.id,
          label: `${c.code} — ${c.description}`,
        }))}
      />
    </div>
  );
}
