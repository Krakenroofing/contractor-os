import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listEmployees } from '@/lib/data/employees';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { TimeEntryForm } from '@/modules/payroll/components/time-entry-form';
import { todayISO } from '@/modules/payroll/lib/periods';
import type { EmploymentType } from '@/modules/employees/schema';

export const dynamic = 'force-dynamic';

export default async function NewTimeEntryPage({
  searchParams,
}: {
  searchParams?: Promise<{ employeeId?: string; workDate?: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) redirect('/payroll');

  const companyId = await getActiveCompanyId();
  const [employees, projects, costCodes] = await Promise.all([
    listEmployees(companyId),
    listProjects(companyId),
    listCostCodes(companyId),
  ]);

  const sp = (await searchParams) ?? {};
  const prefillEmployeeId =
    typeof sp.employeeId === 'string' ? sp.employeeId : '';
  const prefillWorkDate =
    typeof sp.workDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.workDate)
      ? sp.workDate
      : todayISO();

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/payroll">
        <Button variant="outline" size="sm">
          ← Back to Payroll
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Add time entry
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick the employee first — the form switches between Hours
          (hourly / salaried) and Amount (piecework / contract / commission
          / lump-sum) based on their type. The weekly period (Mon–Sun
          containing the date) is found or created automatically.
        </p>
      </header>

      <TimeEntryForm
        initial={{
          employeeId: prefillEmployeeId,
          workDate: prefillWorkDate,
          entryType: 'hours',
          hours: '',
          amount: '',
          projectId: '',
          costCodeId: '',
          isOverhead: false,
          notes: '',
        }}
        employees={employees
          .filter((e) => e.active)
          .map((e) => ({
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
