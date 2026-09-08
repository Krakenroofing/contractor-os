// Field → new work order (service call). Needs an employee link — the
// call's labor is credited to real employees.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { getCurrentUser } from '@/lib/auth';
import { listEmployees } from '@/lib/data/employees';
import { todayISOInTZ } from '@/lib/tz';
import { FieldWorkOrderForm } from '@/modules/work-orders/components/field-work-order-form';

export const dynamic = 'force-dynamic';

export default async function FieldWorkOrderNewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);
  const employee = await getActiveEmployee();

  if (!employee) {
    return (
      <div className="px-4 py-5 space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Work order</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your account has no linked employee record, so a work order can&apos;t
          credit your hours. Ask the office to link your account on the Invite
          Users page.
        </div>
        <Link href={{ pathname: '/field' }} className="text-sm text-slate-600 underline">
          ← Back to home
        </Link>
      </div>
    );
  }

  const companyId = await getActiveCompanyId();
  const employees = (await listEmployees(companyId))
    .filter((e) => e.active)
    .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }));

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Work order</h1>
        <Link href={{ pathname: '/field' }} className="text-xs text-slate-500">
          ← Back
        </Link>
      </header>
      <p className="text-sm text-slate-500">
        A service call: who was on it, hours, materials, and the repairs done.
        The office will add the client and invoice it.
      </p>
      <FieldWorkOrderForm
        selfEmployeeId={employee.id}
        employees={employees}
        todayIso={todayISOInTZ()}
      />
    </div>
  );
}
