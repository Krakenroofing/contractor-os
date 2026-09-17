import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ProposalForm,
  type EstimateOption,
  type ProjectOption,
} from '@/modules/proposals/components/proposal-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listEstimates } from '@/lib/data/estimates';
import { nextProposalNumber } from '@/lib/data/proposals';
import { getCustomer, listCustomers } from '@/lib/data/customers';
import { getProject, listProjects } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';


export default async function NewProposalPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'proposals')) redirect('/proposals');
  const companyId = await getActiveCompanyId();
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
          Link an estimate to anchor the project, customer, and total — or go
          standalone and pick the project directly. Have a finished proposal
          PDF already?{' '}
          <Link href="/proposals/upload" className="underline">
            Create it from the PDF
          </Link>
          .
        </p>
      </header>

      <ProposalForm
        estimates={estimates}
        projects={projects}
        customers={(await listCustomers(companyId)).map((c) => ({ id: c.id, name: c.name }))}
        defaultNumber={await nextProposalNumber(companyId)}
        proofreadAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </div>
  );
}
