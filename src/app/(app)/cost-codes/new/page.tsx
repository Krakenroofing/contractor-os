import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CostCodeForm } from '@/modules/cost-codes/components/cost-code-form';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function NewCostCodePage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) redirect('/cost-codes');
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/cost-codes">
        <Button variant="outline" size="sm">
          ← Back to Cost Codes
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New cost code</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add a code so estimates, POs, and job costs can roll up against it.
        </p>
      </header>

      <CostCodeForm />
    </div>
  );
}
