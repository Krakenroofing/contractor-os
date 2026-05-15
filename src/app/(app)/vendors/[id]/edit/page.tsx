import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { VendorForm } from '@/modules/vendors/components/vendor-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getVendor } from '@/lib/data/vendors';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';

export const dynamic = 'force-dynamic';

export default async function EditVendorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) redirect('/vendors');

  const companyId = await getActiveCompanyId();
  const [vendor, costCodes, accountingAccounts] = await Promise.all([
    getVendor(companyId, id),
    listCostCodes(companyId),
    listAccountingAccounts(companyId),
  ]);
  if (!vendor) notFound();

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/vendors', label: 'Vendors' },
          { href: `/vendors/${vendor.id}`, label: vendor.name },
          { label: 'Edit' },
        ]}
      />

      <Link href={`/vendors/${vendor.id}`}>
        <Button variant="outline" size="sm">
          ← Back to {vendor.name}
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit vendor</h1>
        <p className="text-sm text-slate-500 mt-1">
          Update contact info, address, payment terms, or notes.
        </p>
      </header>

      <VendorForm
        mode={{ kind: 'edit', id: vendor.id }}
        initial={{
          id: vendor.id,
          name: vendor.name,
          vendorType: vendor.isSubcontractor ? 'subcontractor' : 'supplier',
          primaryContactName: vendor.primaryContactName ?? '',
          email: vendor.email ?? '',
          phone: vendor.phone ?? '',
          addressLine1: vendor.addressLine1 ?? '',
          city: vendor.city ?? '',
          state: vendor.state ?? '',
          postalCode: vendor.postalCode ?? '',
          defaultTerms: vendor.defaultTerms ?? '',
          notes: vendor.notes ?? '',
          defaultCostCodeId: vendor.defaultCostCodeId ?? '',
          defaultCostType: vendor.defaultCostType ?? '',
          defaultAccountingAccountId: vendor.defaultAccountingAccountId ?? '',
        }}
        costCodes={costCodes.map((c) => ({
          id: c.id,
          label: `${c.code} — ${c.description}`,
        }))}
        accountingAccounts={accountingAccounts
          .filter((a) => !a.isArchived)
          .map((a) => ({
            id: a.id,
            label: a.code ? `${a.code} — ${a.name}` : a.name,
          }))}
      />
    </div>
  );
}
