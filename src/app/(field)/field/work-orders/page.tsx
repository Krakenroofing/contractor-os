// Field → my work orders: the crew member's own submitted service calls
// with their office status, plus the button to start a new one.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { getCurrentUser } from '@/lib/auth';
import { listWorkOrders } from '@/lib/data/work-orders';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, { label: string; tone: 'blue' | 'green' | 'slate' }> = {
  submitted: { label: 'With the office', tone: 'blue' },
  posted: { label: 'Logged & posted', tone: 'green' },
  void: { label: 'Voided', tone: 'slate' },
};

export default async function FieldWorkOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);
  const employee = await getActiveEmployee();
  const companyId = await getActiveCompanyId();
  const mine = employee
    ? await listWorkOrders(companyId, { createdByEmployeeId: employee.id })
    : [];

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Work orders</h1>
        <Link href={{ pathname: '/field' }} className="text-xs text-slate-500">
          ← Back
        </Link>
      </header>

      <Link href={{ pathname: '/field/work-orders/new' }}>
        <Button className="w-full h-12 text-base">+ New work order</Button>
      </Link>

      {mine.length === 0 ? (
        <p className="text-sm text-slate-500">
          No work orders yet — submit your first service call above.
        </p>
      ) : (
        <ul className="space-y-2">
          {mine.map((wo) => {
            const s = STATUS_LABEL[wo.status] ?? STATUS_LABEL.submitted;
            return (
              <li key={wo.id}>
                {/* Whole card links to the detail — where photos can still
                    be added until the office posts the call. */}
                <Link
                  href={{ pathname: `/field/work-orders/${wo.id}` }}
                  className="block rounded-xl border border-slate-200 bg-white px-4 py-3 active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {wo.number}
                      <span className="ml-2 font-normal text-slate-500">
                        {wo.workDate}
                      </span>
                    </p>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  {wo.requestedBy && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Requested by {wo.requestedBy}
                    </p>
                  )}
                  {wo.repairsDone && (
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                      {wo.repairsDone}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-blue-700">
                    View / add photos ›
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
