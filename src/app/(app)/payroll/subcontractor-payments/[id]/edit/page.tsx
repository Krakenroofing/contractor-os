import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import { getSubcontractorPayment } from '@/lib/data/subcontractor-payments';
import { SubPaymentForm } from '@/modules/subcontractor-payments/components/sub-payment-form';
import { DeleteSubPaymentButton } from '@/modules/subcontractor-payments/components/delete-sub-payment-button';
import type { SubPaymentStatus } from '@/modules/subcontractor-payments/schema';

export const dynamic = 'force-dynamic';

export default async function EditSubPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'payroll')) redirect('/payroll');

  const companyId = await getActiveCompanyId();
  const payment = await getSubcontractorPayment(companyId, id);
  if (!payment) notFound();

  const [projects, vendors] = await Promise.all([
    listProjects(companyId),
    listVendors(companyId),
  ]);

  // Edit view still shows the row's current vendor even if they've been
  // marked non-subcontractor since — otherwise the picker would render
  // empty and lose the FK. We include the existing vendor regardless.
  const subcontractors = vendors
    .filter((v) => v.isSubcontractor || v.id === payment.vendorId)
    .map((v) => ({ id: v.id, label: v.name }));

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/payroll?view=subs">
        <Button variant="outline" size="sm">
          ← Back to Payroll
        </Button>
      </Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Edit subcontractor payment
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            To record a retainage release, drop &ldquo;Retainage held&rdquo; toward
            zero — net paid recalculates automatically.
          </p>
        </div>
        <DeleteSubPaymentButton paymentId={payment.id} />
      </header>

      <SubPaymentForm
        mode={{ kind: 'edit', id: payment.id }}
        initial={{
          id: payment.id,
          vendorId: payment.vendorId,
          projectId: payment.projectId ?? '',
          workPeriodStart: payment.workPeriodStart,
          workPeriodEnd: payment.workPeriodEnd,
          scopeDescription: payment.scopeDescription,
          grossAmount: payment.grossAmount,
          retainagePercent: payment.retainagePercent,
          retainageHeld: payment.retainageHeld,
          paidDate: payment.paidDate ?? '',
          status: payment.status as SubPaymentStatus,
          notes: payment.notes ?? '',
        }}
        subcontractors={subcontractors}
        projects={projects.map((p) => ({ id: p.id, label: p.name }))}
      />
    </div>
  );
}
