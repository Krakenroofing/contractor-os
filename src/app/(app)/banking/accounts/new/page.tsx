import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { BankAccountForm } from '@/modules/banking/components/bank-account-form';

export const dynamic = 'force-dynamic';

export default async function NewBankAccountPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'bank_accounts')) redirect('/banking' as never);
  const company = await getActiveCompany();
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={{ pathname: '/banking' }}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← Back to Banking
          </Link>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">
            Add bank account
          </h1>
          <p className="text-sm text-slate-500">
            Creates a paired entry in the Chart of Accounts so this account is
            available as a category target later. Adding the first account
            also seeds default income / expense / VAT accounts for this
            company.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <BankAccountForm defaultCurrency={company.defaultCurrency} />
        </CardContent>
      </Card>
    </div>
  );
}
