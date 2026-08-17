import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { AccountingCategoriesManager } from '@/modules/accounting/components/accounting-categories-manager';
import type { ManagedCategory } from '@/modules/accounting/components/accounting-categories-manager';
import type { CategoryGroup } from '@/modules/accounting/categories';

export const dynamic = 'force-dynamic';

// rollup_group → operator-facing group. P&L groups plus the balance-sheet
// groups; vat_tax stays system-managed (no entry here).
const ROLLUP_TO_GROUP: Record<string, CategoryGroup | undefined> = {
  income: 'income',
  cogs: 'cogs',
  opex: 'opex',
  asset: 'asset',
  liability: 'liability',
  equity: 'equity',
};
// Leaf types the operator may manage. Reserved system types (owner_equity,
// bank, credit_card, vat_*) are intentionally excluded so they stay protected.
const MANAGED_TYPES = new Set([
  'income',
  'expense',
  'cogs_job_cost',
  'asset',
  'liability',
  'equity',
]);

export default async function AccountingCategoriesPage() {
  const role = await getActiveRole();
  if (!canView(role, 'settings')) redirect('/settings' as never);

  const company = await getActiveCompany();
  const accounts = await listAccountingAccounts(company.id);

  // Leaf categories only (section headers have parent_id NULL); skip system
  // bank / VAT / equity accounts. A row whose parent is itself a category
  // (not a section header) is a subaccount.
  const parentIdOf = new Map(accounts.map((a) => [a.id, a.parentId]));
  const categories: ManagedCategory[] = accounts
    .filter((a) => a.parentId !== null && MANAGED_TYPES.has(a.type))
    .map((a) => {
      const group = ROLLUP_TO_GROUP[a.rollupGroup];
      if (!group) return null;
      const parentIsCategory =
        a.parentId !== null && (parentIdOf.get(a.parentId) ?? null) !== null;
      return {
        id: a.id,
        name: a.name,
        group,
        archived: a.isArchived,
        parentCategoryId: parentIsCategory ? a.parentId : null,
      };
    })
    .filter((c): c is ManagedCategory => c !== null);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/settings', label: 'Settings' },
          { label: 'Accounting categories' },
        ]}
      />

      <Link href="/settings">
        <Button variant="outline" size="sm">
          ← Back to Settings
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Accounting categories
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          The categories you assign to transactions, receipts, and invoice
          lines for <span className="font-medium text-slate-900">{company.name}</span>.
          Add your own, rename, or archive ones you don&apos;t use. Archived
          categories stop appearing in the pickers but stay on past records.
        </p>
      </header>

      <Card>
        <CardContent className="p-6">
          <AccountingCategoriesManager categories={categories} />
        </CardContent>
      </Card>
    </div>
  );
}
