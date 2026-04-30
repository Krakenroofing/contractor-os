import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getMockCustomer,
  getMockEstimate,
  getMockProject,
  listMockProposals,
} from '@/lib/mock-store';
import { ProposalsListClient } from '@/modules/proposals/components/proposals-list-client';

export const dynamic = 'force-dynamic';

export default async function ProposalsPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'proposals');
  const proposals = listMockProposals(companyId).map((p) => {
    const project = getMockProject(companyId, p.projectId);
    const customer = project ? getMockCustomer(companyId, project.customerId) : undefined;
    const estimate = getMockEstimate(companyId, p.estimateId);
    return {
      id: p.id,
      number: p.number,
      projectName: project?.name ?? '—',
      customerName: customer?.name ?? '—',
      estimateNumber: estimate?.number ?? '—',
      status: p.status,
      proposalDate: p.proposalDate,
      expiryDate: p.expiryDate,
      total: p.total,
    };
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Demo mode — proposals loaded from the in-memory mock store.
      </div>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Proposals</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {proposals.length} {proposals.length === 1 ? 'proposal' : 'proposals'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/proposals/new">
            <Button>New Proposal</Button>
          </Link>
        )}
      </header>

      <ProposalsListClient proposals={proposals} />
    </div>
  );
}
