import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { EstimateHeaderEditForm } from '@/modules/estimates/components/estimate-header-edit-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getEstimate } from '@/lib/data/estimates';

export const dynamic = 'force-dynamic';

export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'estimates')) redirect('/estimates');

  const companyId = await getActiveCompanyId();
  const estimate = await getEstimate(companyId, id);
  if (!estimate) notFound();

  // Belt-and-suspenders to the action's status check: don't even render the
  // form for a non-draft estimate. Bounce to the detail page where the
  // status panel can drive next steps.
  if (estimate.status !== 'draft') {
    redirect(`/estimates/${id}` as never);
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/estimates', label: 'Estimates' },
          { href: `/estimates/${estimate.id}`, label: estimate.number },
          { label: 'Edit' },
        ]}
      />

      <Link href={{ pathname: `/estimates/${estimate.id}` }}>
        <Button variant="outline" size="sm">
          ← Back to estimate
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit estimate</h1>
        <p className="text-sm text-slate-500 mt-1">
          Header-only edit. Line items aren&apos;t editable through this form
          yet — re-create the estimate from scratch if you need to change the
          line items. Estimate number is locked.
        </p>
      </header>

      <EstimateHeaderEditForm
        id={estimate.id}
        initialValidUntil={estimate.validUntil ?? ''}
      />
    </div>
  );
}
