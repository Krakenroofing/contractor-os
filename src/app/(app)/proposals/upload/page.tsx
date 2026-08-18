import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listEstimates } from '@/lib/data/estimates';
import { nextProposalNumber } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject, listProjects } from '@/lib/data/projects';
import { ProposalPdfUpload } from '@/modules/proposals/components/proposal-pdf-upload';
import type {
  EstimateOption,
  ProjectOption,
} from '@/modules/proposals/components/proposal-form';

export const dynamic = 'force-dynamic';

export default async function ProposalUploadPage() {
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
        <h1 className="text-2xl font-semibold text-slate-900">
          Create proposal from PDF
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload a finished proposal (e.g. one drafted in Claude). The scope,
          inclusions, exclusions, payment schedule, warranty, terms, date, and
          total are read into an editable form; the PDF itself is archived in
          the project&apos;s documents.
        </p>
      </header>

      <ProposalPdfUpload
        estimates={estimates}
        projects={projects}
        defaultNumber={await nextProposalNumber(companyId)}
      />
    </div>
  );
}
