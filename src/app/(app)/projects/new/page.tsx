import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ProjectForm } from '@/modules/projects/components/project-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listCustomers } from '@/lib/data/customers';
import { listLaborCostCodeOptions } from '@/lib/data/cost-codes';
import { sanitizeReturnTo, returnToLabel } from '@/lib/return-to';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) redirect('/projects');
  const companyId = await getActiveCompanyId();
  const [customersRaw, laborCostCodes] = await Promise.all([
    listCustomers(companyId),
    listLaborCostCodeOptions(companyId),
  ]);
  const customers = customersRaw.map((c) => ({ id: c.id, name: c.name }));
  const returnTo = sanitizeReturnTo((await searchParams)?.returnTo);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href={(returnTo ?? '/projects') as never}>
        <Button variant="outline" size="sm">
          {returnTo ? `← Back to ${returnToLabel(returnTo)}` : '← Back to Projects'}
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New project</h1>
        <p className="text-sm text-slate-500 mt-1">
          Create a project to start tracking budget, change orders, and gross profit.
        </p>
      </header>

      <ProjectForm
        customers={customers}
        laborCostCodes={laborCostCodes}
        returnTo={returnTo ?? undefined}
      />
    </div>
  );
}
