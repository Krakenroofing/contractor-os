import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CustomerForm } from '@/modules/customers/components/customer-form';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function NewCustomerPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'customers')) redirect('/customers');
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/customers">
        <Button variant="outline" size="sm">
          ← Back to Customers
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New customer</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add a customer to start building estimates and projects against them.
        </p>
      </header>

      <CustomerForm />
    </div>
  );
}
