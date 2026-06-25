import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { AccountingSettingsForm } from '@/modules/settings/components/accounting-settings-form';

export const dynamic = 'force-dynamic';

export default async function AccountingSettingsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'settings')) redirect('/settings' as never);

  const company = await getActiveCompany();

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
        <CardContent className="p-6">
          <AccountingSettingsForm company={company} />
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
