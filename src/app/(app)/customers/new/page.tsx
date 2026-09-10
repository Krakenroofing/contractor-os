import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CustomerForm } from '@/modules/customers/components/customer-form';
import { getActiveRole } from '@/lib/active-role';
import { getActiveCompanyId } from '@/lib/active-company';
import { canCreate } from '@/lib/permissions';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';

export const dynamic = 'force-dynamic';

export default async function NewCustomerPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'customers')) redirect('/customers');
  const companyId = await getActiveCompanyId();
  const intercompanyAccountOptions = (await listAccountingAccounts(companyId))
    .filter(
      (a) =>
        !a.isArchived &&
        ['asset', 'liability'].includes(a.rollupGroup as string),
    )
    .map((a) => ({ id: a.id, label: a.name }));
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

      <CustomerForm intercompanyAccountOptions={intercompanyAccountOptions} />
    </div>
  );
}
