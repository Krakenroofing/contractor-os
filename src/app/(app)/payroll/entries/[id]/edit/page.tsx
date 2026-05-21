import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listEmployees } from '@/lib/data/employees';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { getTimeEntry } from '@/lib/data/time-entries';
import { TimeEntryForm } from '@/modules/payroll/components/time-entry-form';
import { DeleteTimeEntryButton } from '@/modules/payroll/components/delete-time-entry-button';
import type { EmploymentType } from '@/modules/employees/schema';

export const dynamic = 'force-dynamic';

export default async function EditTimeEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) redirect('/payroll');

  const companyId = await getActiveCompanyId();
  const entry = await getTimeEntry(companyId, id);
  if (!entry) notFound();

  const [employees, projects, costCodes] = await Promise.all([
    listEmployees(companyId),
    listProjects(companyId),
    listCostCodes(companyId),
  ]);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href={`/payroll?week=${entry.workDate}`}>
        <Button variant="outline" size="sm">
          ← Back to Payroll
        </Button>
      </Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Edit time entry
          </h1>
        </div>
        <DeleteTimeEntryButton entryId={entry.id} />
      </header>

      <TimeEntryForm
        mode={{ kind: 'edit', id: entry.id }}
        initial={{
          id: entry.id,
          employeeId: entry.employeeId,
          workDate: entry.workDate,
          entryType: entry.entryType as 'hours' | 'amount',
          hours: entry.hours,
          amount: entry.amount,
          projectId: entry.projectId ?? '',
          costCodeId: entry.costCodeId ?? '',
          notes: entry.notes ?? '',
        }}
        employees={employees.map((e) => ({
          id: e.id,
          label: `${e.firstName} ${e.lastName}`.trim(),
          employmentType: e.employmentType as EmploymentType,
        }))}
        projects={projects.map((p) => ({ id: p.id, label: p.name }))}
        costCodes={costCodes.map((c) => ({
          id: c.id,
          label: `${c.code} — ${c.description}`,
        }))}
      />
    </div>
  );
}
