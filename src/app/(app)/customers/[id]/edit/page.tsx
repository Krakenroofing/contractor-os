import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { CustomerForm } from '@/modules/customers/components/customer-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getCustomer } from '@/lib/data/customers';

export const dynamic = 'force-dynamic';

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'customers')) redirect('/customers');

  const companyId = await getActiveCompanyId();
  const customer = await getCustomer(companyId, id);
  if (!customer) notFound();

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/customers', label: 'Customers' },
          { href: `/customers/${customer.id}`, label: customer.name },
          { label: 'Edit' },
        ]}
      />

      <Link href={`/customers/${customer.id}`}>
        <Button variant="outline" size="sm">
          ← Back to {customer.name}
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit customer</h1>
        <p className="text-sm text-slate-500 mt-1">
          Update contact info, billing address, or notes.
        </p>
      </header>

      <CustomerForm
        mode={{ kind: 'edit', id: customer.id }}
        initial={{
          id: customer.id,
          name: customer.name,
          customerType: customer.customerType,
          primaryContactName: customer.primaryContactName ?? '',
          email: customer.email ?? '',
          phone: customer.phone ?? '',
          billingAddressLine1: customer.billingAddressLine1 ?? '',
          billingCity: customer.billingCity ?? '',
          billingState: customer.billingState ?? '',
          billingPostalCode: customer.billingPostalCode ?? '',
          notes: customer.notes ?? '',
        }}
      />
    </div>
  );
}
