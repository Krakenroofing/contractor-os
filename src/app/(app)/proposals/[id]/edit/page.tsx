import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ProposalForm,
  type EstimateOption,
  type ProjectOption,
  type ProposalFormInitial,
} from '@/modules/proposals/components/proposal-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listEstimates } from '@/lib/data/estimates';
import { getProposal } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject, listProjects } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';

export default async function EditProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'proposals')) redirect('/proposals');
  const companyId = await getActiveCompanyId();

  const proposal = await getProposal(companyId, id);
  if (!proposal) notFound();

  // Same estimate list the New page builds — proposal can re-anchor to any
  // of these. The selected one will pre-fill from initial.estimateId.
  const estimates: EstimateOption[] = await Promise.all(
    (await listEstimates(companyId)).map(async (e) => {
      const project = await getProject(companyId, e.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      return {
        id: e.id,
        number: e.number,
        projectName: project?.name ?? 'Unknown project',
        customerName: customer?.name ?? 'Unknown customer',
        total: e.total,
      };
    }),
  );

  const projects: ProjectOption[] = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        name: p.name,
        customerName: customer?.name ?? '—',
      };
    }),
  );

  const initial: ProposalFormInitial = {
    id: proposal.id,
    number: proposal.number,
    estimateId: proposal.estimateId ?? '',
    projectId: proposal.projectId,
    total: proposal.total,
    status: proposal.status,
    proposalDate: proposal.proposalDate,
    expiryDate: proposal.expiryDate,
    scopeOfWork: proposal.scopeOfWork,
    inclusions: proposal.inclusions,
    exclusions: proposal.exclusions,
    paymentSchedule: proposal.paymentSchedule,
    warrantyNotes: proposal.warrantyNotes,
    termsAndConditions: proposal.termsAndConditions,
  };

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Link href={`/proposals/${proposal.id}`}>
        <Button variant="outline" size="sm">
          ← Back to Proposal
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Edit proposal {proposal.number}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Adjust scope, terms, or status. The proposal&apos;s total stays tied
          to the linked estimate&apos;s total.
        </p>
      </header>

      <ProposalForm
        estimates={estimates}
        projects={projects}
        defaultNumber={proposal.number}
        initial={initial}
      />
    </div>
  );
}
