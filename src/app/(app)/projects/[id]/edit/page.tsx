import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { ProjectForm } from '@/modules/projects/components/project-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listCustomers } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) redirect('/projects');

  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, id);
  if (!project) notFound();
  const customers = (await listCustomers(companyId)).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/projects', label: 'Projects' },
          { href: `/projects/${project.id}`, label: project.name },
          { label: 'Edit' },
        ]}
      />

      <Link href={`/projects/${project.id}`}>
        <Button variant="outline" size="sm">
          ← Back to {project.name}
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit project</h1>
        <p className="text-sm text-slate-500 mt-1">
          Update name, status, jobsite, contract value, or budget. Project
          number is locked.
        </p>
      </header>

      <ProjectForm
        customers={customers}
        mode={{ kind: 'edit', id: project.id }}
        initial={{
          id: project.id,
          customerId: project.customerId,
          number: project.number,
          name: project.name,
          status: project.status,
          jobsiteAddressLine1: project.jobsiteAddressLine1 ?? '',
          jobsiteCity: project.jobsiteCity ?? '',
          jobsiteState: project.jobsiteState ?? '',
          jobsitePostalCode: project.jobsitePostalCode ?? '',
          startDate: project.startDate ?? '',
          targetCompletionDate: project.targetCompletionDate ?? '',
          contractValue: project.contractValue,
          estimatedBudget: project.currentBudget,
          notes: project.notes ?? '',
        }}
      />
    </div>
  );
}
