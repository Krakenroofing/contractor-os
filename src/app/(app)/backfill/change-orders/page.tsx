import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { listChangeOrders } from '@/lib/data/change-orders';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { ChangeOrderMiniForm } from '@/modules/backfill/components/change-order-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillChangeOrdersPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const [projects, changeOrders] = await Promise.all([
    listProjects(companyId),
    listChangeOrders(companyId),
  ]);
  const recent = changeOrders.filter(
    (c) =>
      (c.submittedAt &&
        new Date(`${c.submittedAt}T00:00:00Z`).getTime() >= CUTOFF.getTime()) ||
      (c.approvedAt &&
        new Date(`${c.approvedAt}T00:00:00Z`).getTime() >= CUTOFF.getTime()) ||
      c.createdAt.getTime() >= CUTOFF.getTime(),
  );

  return (
    <StepShell
      step="change-orders"
      prevHref="/backfill/proposals"
      nextHref="/backfill/invoices"
    >
      <Card>
        <CardHeader>
          <CardTitle>Add a change order</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangeOrderMiniForm
            projects={projects.map((p) => ({
              id: p.id,
              label: `${p.number} — ${p.name}`,
            }))}
          />
          <p className="text-xs text-slate-500 mt-3">
            Approving a CO automatically rolls its total into the project&apos;s
            contract value.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Change orders entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/change-orders' }} className="text-sm text-slate-500 hover:underline">
              Full CO list →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No change orders backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((c) => (
                <li
                  key={c.id}
                  className="py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      <span className="font-mono text-xs text-slate-500 mr-2">
                        {c.number}
                      </span>
                      {formatMoney(c.total)}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {c.submittedAt ?? '—'}
                      {c.approvedAt ? ` · approved ${c.approvedAt}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{c.status}</Badge>
                    <Link
                      href={{ pathname: `/change-orders/${c.id}` }}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
