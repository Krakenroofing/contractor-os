import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { listChangeOrders } from '@/lib/data/change-orders';
import { getProposal } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  ChangeOrdersListClient,
  type ChangeOrderRow,
} from '@/modules/change-orders/components/change-orders-list-client';

export const dynamic = 'force-dynamic';

export default async function ChangeOrdersPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'change_orders');
  const cos = await listChangeOrders(companyId);
  const rows: ChangeOrderRow[] = await Promise.all(
    cos.map(async (c) => {
      const project = await getProject(companyId, c.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      const proposal = c.proposalId
        ? await getProposal(companyId, c.proposalId)
        : undefined;
      return {
        id: c.id,
        number: c.number,
        projectName: project?.name ?? '—',
        customerName: customer?.name ?? '—',
        proposalNumber: proposal?.number ?? null,
        status: c.status,
        submittedAt: c.submittedAt ?? null,
        approvedAt: c.approvedAt ?? null,
        scheduleImpactDays: c.scheduleImpactDays,
        total: c.total,
      };
    }),
  );

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — change orders loaded from the in-memory mock store
          (<code className="font-mono">src/lib/mock-store.ts</code>). Approved COs roll
          into the project's contract value and approved-CO summary on /projects.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Change Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {rows.length} {rows.length === 1 ? 'change order' : 'change orders'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/change-orders/new">
            <Button>New Change Order</Button>
          </Link>
        )}
      </header>

      <ChangeOrdersListClient rows={rows} />
    </div>
  );
}
