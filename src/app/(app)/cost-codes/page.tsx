import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { listCostCodes } from '@/lib/data/cost-codes';
import { CostCodesExplorer } from '@/modules/cost-codes/components/cost-codes-explorer';

export const dynamic = 'force-dynamic';

export default async function CostCodesPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'cost_codes');
  const codes = await listCostCodes(companyId);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — cost codes loaded from the in-memory mock store
          (<code className="font-mono">src/lib/mock-store.ts</code>) plus the
          standard global library defined in
          <code className="font-mono"> src/lib/data/cost-code-defaults.ts</code>.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cost Codes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Standard global library + your company custom codes. Group by
            division, filter, and toggle active/inactive.
          </p>
        </div>
        {allowCreate && (
          <Link href="/cost-codes/new">
            <Button>New Cost Code</Button>
          </Link>
        )}
      </header>

      {codes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No cost codes yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Add codes so estimates and POs can roll up by division.
          </p>
          <div className="mt-4 inline-flex">
            <Link href="/cost-codes/new">
              <Button>New Cost Code</Button>
            </Link>
          </div>
        </div>
      ) : (
        <CostCodesExplorer codes={codes} canEdit={allowCreate} />
      )}
    </div>
  );
}
