import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { VendorForm } from '@/modules/vendors/components/vendor-form';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';

export const dynamic = 'force-dynamic';

export default async function NewVendorPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) redirect('/vendors');
  const companyId = await getActiveCompanyId();
  const [costCodes, accountingAccounts] = await Promise.all([
    listCostCodes(companyId),
    listAccountingAccounts(companyId),
  ]);
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/vendors">
        <Button variant="outline" size="sm">
          ← Back to Vendors
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New vendor</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add a supplier or subcontractor so you can issue POs against them.
        </p>
      </header>

      <VendorForm
        costCodes={costCodes.map((c) => ({
          id: c.id,
          label: `${c.code} — ${c.description}`,
        }))}
        accountingAccounts={toAccountingAccountOptions(
          accountingAccounts.filter(
            (a) => a.type !== 'bank' && a.type !== 'credit_card',
          ),
        )}
      />
    </div>
  );
}
