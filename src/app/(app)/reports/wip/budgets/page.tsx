import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { listAllProjectFinancials } from '@/modules/job-costing/lib/financials';
import {
  WipBudgetsClient,
  type BudgetRow,
} from '@/modules/reports/components/wip-budgets-client';

export const dynamic = 'force-dynamic';

export default async function WipBudgetsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();

  const financials = await listAllProjectFinancials(company.id);
  const rows: BudgetRow[] = financials
    .filter((f) => f.revisedContractValue > 0)
    .sort((a, b) => {
      const aActive = a.status === 'in_progress' || a.status === 'won' ? 0 : 1;
      const bActive = b.status === 'in_progress' || b.status === 'won' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.revisedContractValue - a.revisedContractValue;
    })
    .map((f) => ({
      projectId: f.projectId,
      projectName: f.projectName,
      customerName: f.customerName,
      status: f.status,
      contractValue: f.revisedContractValue,
      actualCost: f.actualCost,
      budget: f.budget,
    }));

  const canEdit = canCreate(role, 'projects');

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link
          href={{ pathname: '/reports/wip' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to WIP report
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          Set job budgets
        </h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Enter an estimated total cost (budget) for each job. This is the
          baseline for percent-complete, so once a budget is set the WIP report
          and the P&amp;L revenue-recognition section show earned revenue for
          that job. Active jobs are listed first.
        </p>
      </div>

      <WipBudgetsClient rows={rows} canEdit={canEdit} />
    </div>
  );
}
