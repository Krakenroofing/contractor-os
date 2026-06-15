import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EstimateForm } from '@/modules/estimates/components/estimate-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listEstimates } from '@/lib/data/estimates';
import { getCustomer, listCustomers } from '@/lib/data/customers';
import { listInventoryItems } from '@/lib/data/inventory-items';
import { listProjects } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';

async function nextEstimateNumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await listEstimates(companyId);
  const matching = existing
    .map((e) => e.number)
    .filter((n) => n.startsWith(`EST-${year}-`))
    .map((n) => Number(n.slice(`EST-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `EST-${year}-${String(next).padStart(3, '0')}`;
}

export default async function NewEstimatePage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'estimates')) redirect('/estimates');
  const companyId = await getActiveCompanyId();
  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        label: `${p.name}${customer ? ` (${customer.name})` : ''}`,
      };
    }),
  );
  const customers = (await listCustomers(companyId)).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const costCodes = (await listCostCodes(companyId)).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
  }));
  const products = (await listInventoryItems(companyId)).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    sku: p.sku,
    unit: p.unit,
    defaultCost: Number(p.defaultCost),
  }));

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Link href="/estimates">
        <Button variant="outline" size="sm">
          ← Back to Estimates
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New estimate</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add line items by cost code. Subtotal, markup, and total update live.
        </p>
      </header>

      <EstimateForm
        projects={projects}
        customers={customers}
        costCodes={costCodes}
        products={products}
        defaultNumber={await nextEstimateNumber(companyId)}
      />
    </div>
  );
}
