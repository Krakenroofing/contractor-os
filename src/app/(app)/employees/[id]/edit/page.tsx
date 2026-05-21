import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getEmployee } from '@/lib/data/employees';
import { EmployeeForm } from '@/modules/employees/components/employee-form';
import type { EmploymentType } from '@/modules/employees/schema';

export const dynamic = 'force-dynamic';

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'employees')) redirect(`/employees/${id}`);

  const companyId = await getActiveCompanyId();
  const employee = await getEmployee(companyId, id);
  if (!employee) notFound();

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href={`/employees/${id}`}>
        <Button variant="outline" size="sm">
          ← Back to Employee
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit employee</h1>
      </header>

      <EmployeeForm
        mode={{ kind: 'edit', id }}
        initial={{
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          nibNumber: employee.nibNumber ?? '',
          email: employee.email ?? '',
          phone: employee.phone ?? '',
          employmentType: employee.employmentType as EmploymentType,
          payRate: employee.payRate,
          hireDate: employee.hireDate ?? '',
          terminationDate: employee.terminationDate ?? '',
          active: employee.active,
          notes: employee.notes ?? '',
        }}
      />
    </div>
  );
}
