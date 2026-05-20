import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ChangeOrderForm,
  type ChangeOrderFormInitial,
} from '@/modules/change-orders/components/change-order-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getChangeOrder,
  getChangeOrderLineItems,
} from '@/lib/data/change-orders';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listProposals } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';

export default async function EditChangeOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'change_orders')) redirect('/change-orders');
  const companyId = await getActiveCompanyId();

  const co = await getChangeOrder(companyId, id);
  if (!co) notFound();
  const lines = await getChangeOrderLineItems(co.id);

  // Same data the New page loads — projects/proposals/cost codes.
  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        label: `${p.name}${customer ? ` (${customer.name})` : ''}`,
      };
    }),
  );
  const proposals = (await listProposals(companyId)).map((p) => ({
    id: p.id,
    projectId: p.projectId,
    label: p.number,
  }));
  const costCodes = (await listCostCodes(companyId)).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
  }));

  const initial: ChangeOrderFormInitial = {
    id: co.id,
    number: co.number,
    projectId: co.projectId,
    proposalId: co.proposalId,
    status: co.status,
    reason: co.reason,
    description: co.description,
    scheduleImpactDays: co.scheduleImpactDays,
    submittedAt: co.submittedAt,
    approvedAt: co.approvedAt,
    customerSignedName: co.customerSignedName,
    lines: lines.map((l) => ({
      costCodeId: l.costCodeId,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unitCost,
      markupPercent: l.markupPercent,
    })),
  };

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Link href={`/change-orders/${co.id}`}>
        <Button variant="outline" size="sm">
          ← Back to Change Order
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Edit change order {co.number}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Adjust scope, line items, or status. If you change an approved CO's
          total or status, the project&apos;s contract value updates automatically.
        </p>
      </header>

      <ChangeOrderForm
        projects={projects}
        proposals={proposals}
        costCodes={costCodes}
        defaultNumber={co.number}
        initial={initial}
      />
    </div>
  );
}
