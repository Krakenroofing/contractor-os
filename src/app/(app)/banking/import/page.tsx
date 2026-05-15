import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { UploadStatementForm } from '@/modules/banking/components/upload-form';

export const dynamic = 'force-dynamic';

export default async function ImportStatementPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'statement_imports')) redirect('/banking' as never);
  const company = await getActiveCompany();
  const accounts = await listBankAccounts(company.id);
  if (accounts.length === 0) redirect('/banking/accounts/new' as never);
  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={{ pathname: '/banking' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Banking
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Import statement
        </h1>
        <p className="text-sm text-slate-500">
          Upload a CSV or XLSX bank/credit-card statement. The next step lets
          you map columns and preview the totals before any rows are saved.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadStatementForm
            accounts={accounts.map((a) => ({
              id: a.id,
              name: a.name,
              type: a.type,
              last4: a.last4,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
