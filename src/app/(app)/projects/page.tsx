import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { ProjectsListClient } from '@/modules/projects/components/projects-list-client';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'projects');
  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        number: p.number,
        name: p.name,
        status: p.status,
        customerName: customer?.name ?? 'Unknown customer',
        contractValue: p.contractValue,
        currentBudget: p.currentBudget,
        totalChangeOrders: p.totalChangeOrders,
      };
    }),
  );

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — projects loaded from the in-memory mock store
          (<code className="font-mono">src/lib/mock-store.ts</code>).
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/projects/new">
            <Button>New Project</Button>
          </Link>
        )}
      </header>

      <ProjectsListClient projects={projects} canCreate={allowCreate} />
    </div>
  );
}
