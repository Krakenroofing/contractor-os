// Office → new work order: log a service call directly (phoned in /
// reported verbally) without waiting for a field submission.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { listCustomers } from '@/lib/data/customers';
import { listEmployees } from '@/lib/data/employees';
import { todayISOInTZ } from '@/lib/tz';
import { OfficeWorkOrderCreateForm } from '@/modules/work-orders/components/office-work-order-create-form';

export const dynamic = 'force-dynamic';

export default async function WorkOrderNewPage() {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) redirect('/work-orders' as never);
  const companyId = await getActiveCompanyId();
  const [employees, customers] = await Promise.all([
    listEmployees(companyId),
    listCustomers(companyId),
  ]);

  return (
    <div className="p-8 space-y-5 max-w-5xl">
      <Link href={{ pathname: '/work-orders' }}>
        <Button variant="ghost" size="sm">
          ← Back to Work Orders
        </Button>
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          New work order
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Log a service call yourself — same as a field submission, then
          review → post → invoice as usual.
        </p>
      </header>
      <OfficeWorkOrderCreateForm
        employees={employees
          .filter((e) => e.active)
          .map((e) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`.trim(),
          }))}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        todayIso={todayISOInTZ()}
      />
    </div>
  );
}
