import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getBankAccount } from '@/lib/data/bank-accounts';
import { BankAccountForm } from '@/modules/banking/components/bank-account-form';

export const dynamic = 'force-dynamic';

export default async function EditBankAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'bank_accounts')) redirect('/banking' as never);
  const company = await getActiveCompany();
  const { id } = await params;
  const account = await getBankAccount(company.id, id);
  if (!account) notFound();

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={{ pathname: `/banking/accounts/${account.id}` }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to {account.name}
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Edit account
        </h1>
        <p className="text-sm text-slate-500">
          Fix the name, type, last 4, currency, or opening balance. The paired
          Chart-of-Accounts entry stays in sync automatically.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <BankAccountForm
            defaultCurrency={company.defaultCurrency}
            initial={{
              id: account.id,
              name: account.name,
              type: account.type,
              last4: account.last4 ?? '',
              currency: account.currency,
              openingBalance: Number(account.openingBalance).toFixed(2),
              openingDate: account.openingDate ?? '',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
