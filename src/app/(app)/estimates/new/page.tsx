import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EstimateForm } from '@/modules/estimates/components/estimate-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getMockCustomer,
  listMockCostCodes,
  listMockEstimates,
  listMockProjects,
} from '@/lib/mock-store';

export const dynamic = 'force-dynamic';

function nextEstimateNumber(companyId: string): string {
  const year = new Date().getFullYear();
  const existing = listMockEstimates(companyId);
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
  const projects = listMockProjects(companyId).map((p) => {
    const customer = getMockCustomer(companyId, p.customerId);
    return {
      id: p.id,
      label: `${p.number} — ${p.name}${customer ? ` (${customer.name})` : ''}`,
    };
  });
  const costCodes = listMockCostCodes(companyId).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
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
        costCodes={costCodes}
        defaultNumber={nextEstimateNumber(companyId)}
      />
    </div>
  );
}
