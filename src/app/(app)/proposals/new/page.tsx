import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ProposalForm,
  type EstimateOption,
} from '@/modules/proposals/components/proposal-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getMockCustomer,
  getMockProject,
  listMockEstimates,
  listMockProposals,
} from '@/lib/mock-store';

export const dynamic = 'force-dynamic';

function nextProposalNumber(companyId: string): string {
  const year = new Date().getFullYear();
  const existing = listMockProposals(companyId);
  const matching = existing
    .map((p) => p.number)
    .filter((n) => n.startsWith(`PROP-${year}-`))
    .map((n) => Number(n.slice(`PROP-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `PROP-${year}-${String(next).padStart(3, '0')}`;
}

export default async function NewProposalPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'proposals')) redirect('/proposals');
  const companyId = await getActiveCompanyId();
  const estimates: EstimateOption[] = listMockEstimates(companyId).map((e) => {
    const project = getMockProject(companyId, e.projectId);
    const customer = project
      ? getMockCustomer(companyId, project.customerId)
      : undefined;
    return {
      id: e.id,
      number: e.number,
      projectName: project?.name ?? 'Unknown project',
      customerName: customer?.name ?? 'Unknown customer',
      total: e.total,
    };
  });

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Link href="/proposals">
        <Button variant="outline" size="sm">
          ← Back to Proposals
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New proposal</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick an estimate to anchor the project, customer, and total. Add scope, terms,
          and signature block to send to the customer.
        </p>
      </header>

      <ProposalForm estimates={estimates} defaultNumber={nextProposalNumber(companyId)} />
    </div>
  );
}
