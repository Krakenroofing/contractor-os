import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listMockCustomers } from '@/lib/mock-store';
import { CustomersListClient } from '@/modules/customers/components/customers-list-client';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'customers');
  const customers = listMockCustomers(companyId).map((c) => ({
    id: c.id,
    name: c.name,
    customerType: c.customerType,
    primaryContactName: c.primaryContactName,
    email: c.email,
    phone: c.phone,
  }));

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Demo mode — customers loaded from the in-memory mock store.
      </div>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {customers.length} {customers.length === 1 ? 'customer' : 'customers'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/customers/new">
            <Button>New Customer</Button>
          </Link>
        )}
      </header>

      <CustomersListClient customers={customers} />
    </div>
  );
}
