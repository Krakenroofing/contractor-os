import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listLaborCostCodeOptions } from '@/lib/data/cost-codes';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import { AccountingSettingsForm } from '@/modules/settings/components/accounting-settings-form';

export const dynamic = 'force-dynamic';

export default async function AccountingSettingsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'settings')) redirect('/settings' as never);

  const company = await getActiveCompany();
  const [accounts, laborCostCodes] = await Promise.all([
    listAccountingAccounts(company.id).then(toAccountingAccountOptions),
    listLaborCostCodeOptions(company.id),
  ]);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/settings', label: 'Settings' },
          { label: 'Accounting' },
        ]}
      />

      <Link href="/settings">
        <Button variant="outline" size="sm">
          ← Back to Settings
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Accounting settings
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Accounting policies for{' '}
          <span className="font-medium text-slate-900">{company.name}</span> —
          method, fiscal year, VAT, and retainage. These drive how the P&amp;L,
          invoices, and VAT reports behave, so changes take effect everywhere at
          once.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Posting periods
            </p>
            <p className="text-xs text-slate-500">
              Close a month so nothing dated in it can be posted or changed.
              Corrections go into an open period.
            </p>
          </div>
          <Link href={'/settings/accounting/periods' as never}>
            <Button variant="outline" size="sm">
              Manage periods →
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <AccountingSettingsForm
            company={company}
            accounts={accounts}
            laborCostCodes={laborCostCodes}
          />
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        Looking for your chart of accounts?{' '}
        <Link
          href={'/settings/accounting-categories' as never}
          className="text-slate-900 underline hover:no-underline"
        >
          Manage accounting categories →
        </Link>
      </p>
    </div>
  );
}
