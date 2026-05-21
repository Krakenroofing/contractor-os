import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { EmployeeForm } from '@/modules/employees/components/employee-form';

export const dynamic = 'force-dynamic';

export default async function NewEmployeePage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'employees')) redirect('/employees');

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/employees">
        <Button variant="outline" size="sm">
          ← Back to Employees
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New employee</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add a payroll-eligible worker. Pay rate + employment type drive the
          weekly gross. NIB is computed automatically from the gross
          (4.65% employee / 6.65% employer, capped at $810/week on Form C-10).
        </p>
      </header>

      <EmployeeForm />
    </div>
  );
}
