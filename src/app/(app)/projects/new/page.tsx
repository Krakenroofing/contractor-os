import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ProjectForm } from '@/modules/projects/components/project-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listCustomers } from '@/lib/data/customers';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) redirect('/projects');
  const companyId = await getActiveCompanyId();
  const customers = (await listCustomers(companyId)).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/projects">
        <Button variant="outline" size="sm">
          ← Back to Projects
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New project</h1>
        <p className="text-sm text-slate-500 mt-1">
          Create a project to start tracking budget, change orders, and gross profit.
        </p>
      </header>

      <ProjectForm customers={customers} />
    </div>
  );
}
