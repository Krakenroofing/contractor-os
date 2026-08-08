import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { listEmployees } from '@/lib/data/employees';
import {
  EmployeesListClient,
  type EmployeeRow,
} from '@/modules/employees/components/employees-list-client';
import type { EmploymentType } from '@/modules/employees/schema';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'employees');

  const employees = await listEmployees(companyId);
  const rows: EmployeeRow[] = employees.map((e) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    fullName: `${e.firstName} ${e.lastName}`.trim(),
    nibNumber: e.nibNumber,
    email: e.email,
    phone: e.phone,
    employmentType: e.employmentType as EmploymentType,
    payRate: e.payRate,
    hireDate: e.hireDate,
    active: e.active,
    nibExempt: e.nibExempt,
    isSubcontractor: e.isSubcontractor,
  }));

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — employees live in the in-memory mock store; start by
          adding a few. Phase 1 of payroll.
        </div>
      )}

      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {rows.length} total · {activeCount} active
          </p>
        </div>
        {allowCreate && (
          <Link href="/employees/new">
            <Button>Add Employee</Button>
          </Link>
        )}
      </header>

      <EmployeesListClient employees={rows} allowCreate={allowCreate} />
    </div>
  );
}
