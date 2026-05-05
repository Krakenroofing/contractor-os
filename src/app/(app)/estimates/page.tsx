import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { listEstimates } from '@/lib/data/estimates';
import { getCustomer } from '@/lib/data/customers';
import { getProject, listProjects } from '@/lib/data/projects';
import { EstimatesListClient } from '@/modules/estimates/components/estimates-list-client';

export const dynamic = 'force-dynamic';

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function EstimatesPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'estimates');
  const estimates = await Promise.all(
    (await listEstimates(companyId)).map(async (e) => {
      const project = await getProject(companyId, e.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      return {
        id: e.id,
        number: e.number,
        projectId: e.projectId,
        projectName: project?.name ?? '—',
        customerName: customer?.name ?? '—',
        status: e.status,
        createdAt: formatDate(e.createdAt),
        subtotal: e.subtotal,
        total: e.total,
      };
    }),
  );

  const projects = (await listProjects(companyId)).map((p) => ({
    id: p.id,
    label: `${p.number} — ${p.name}`,
  }));

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — estimates loaded from the in-memory mock store.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Estimates</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {estimates.length} {estimates.length === 1 ? 'estimate' : 'estimates'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/estimates/new">
            <Button>New Estimate</Button>
          </Link>
        )}
      </header>

      <EstimatesListClient estimates={estimates} projects={projects} />
    </div>
  );
}
