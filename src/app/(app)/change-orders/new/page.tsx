import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChangeOrderForm } from '@/modules/change-orders/components/change-order-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getMockCustomer,
  listMockChangeOrders,
  listMockCostCodes,
  listMockProjects,
  listMockProposals,
} from '@/lib/mock-store';

export const dynamic = 'force-dynamic';

function nextChangeOrderNumber(companyId: string): string {
  const year = new Date().getFullYear();
  const existing = listMockChangeOrders(companyId);
  const matching = existing
    .map((c) => c.number)
    .filter((n) => n.startsWith(`CO-${year}-`))
    .map((n) => Number(n.slice(`CO-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `CO-${year}-${String(next).padStart(3, '0')}`;
}

export default async function NewChangeOrderPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'change_orders')) redirect('/change-orders');
  const companyId = await getActiveCompanyId();
  const projects = listMockProjects(companyId).map((p) => {
    const customer = getMockCustomer(companyId, p.customerId);
    return {
      id: p.id,
      label: `${p.number} — ${p.name}${customer ? ` (${customer.name})` : ''}`,
    };
  });
  const proposals = listMockProposals(companyId).map((p) => ({
    id: p.id,
    projectId: p.projectId,
    label: p.number,
  }));
  const costCodes = listMockCostCodes(companyId).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
  }));

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Link href="/change-orders">
        <Button variant="outline" size="sm">
          ← Back to Change Orders
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New change order</h1>
        <p className="text-sm text-slate-500 mt-1">
          Document the change against a project, optionally link a proposal, and add line
          items by cost code.
        </p>
      </header>

      <ChangeOrderForm
        projects={projects}
        proposals={proposals}
        costCodes={costCodes}
        defaultNumber={nextChangeOrderNumber(companyId)}
      />
    </div>
  );
}
