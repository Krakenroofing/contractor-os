import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import { SubPaymentForm } from '@/modules/subcontractor-payments/components/sub-payment-form';

export const dynamic = 'force-dynamic';

export default async function NewSubPaymentPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) redirect('/payroll');

  const companyId = await getActiveCompanyId();
  const [projects, vendors] = await Promise.all([
    listProjects(companyId),
    listVendors(companyId),
  ]);

  // Only show subcontractors in the picker — issuing a sub-payment to a
  // pure supplier would muddle the books.
  const subcontractors = vendors
    .filter((v) => v.isSubcontractor)
    .map((v) => ({ id: v.id, label: v.name }));

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/payroll?view=subs">
        <Button variant="outline" size="sm">
          ← Back to Payroll
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          New subcontractor payment
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Records gross billed, retainage held, and net paid for a chunk of
          scope a subcontractor has completed. Subcontractors not in the list
          below need to be added under Vendors with the &ldquo;Subcontractor&rdquo;
          type first.
        </p>
      </header>

      {subcontractors.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          No subcontractors on file yet.{' '}
          <Link href="/vendors/new" className="underline font-medium">
            Add one under Vendors
          </Link>{' '}
          (set type to &ldquo;Subcontractor&rdquo;), then come back.
        </div>
      ) : (
        <SubPaymentForm
          subcontractors={subcontractors}
          projects={projects.map((p) => ({ id: p.id, label: p.name }))}
        />
      )}
    </div>
  );
}
